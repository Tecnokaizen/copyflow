import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  DEFAULT_MAX_AUDIO_BYTES,
  DEFAULT_MAX_CLIP_SECONDS,
  maxAudioBytesForClip,
} from "@/lib/ai/voice-orders/audio";
import {
  CLIP_DURATION_TOLERANCE_SECONDS,
  type AudioDuration,
  maxAudioPackets,
  measureAudioDuration,
  opusPacketMicros,
} from "@/lib/ai/voice-orders/audio-duration";

const LIMIT = DEFAULT_MAX_CLIP_SECONDS + CLIP_DURATION_TOLERANCE_SECONDS;
const measure = (bytes: Uint8Array | number[], maxSeconds = LIMIT) =>
  measureAudioDuration(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes), {
    maxSeconds,
  });
const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(path.join(process.cwd(), "lib/ai/voice-orders/__fixtures__/audio", name))
  );

function assertRejected(result: AudioDuration, reason: string, detail?: string) {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (result.ok) return;
  assert.equal(result.reason, reason, JSON.stringify(result));
  if (detail) assert.equal(result.detail, detail, JSON.stringify(result));
}

function assertAccepted(result: AudioDuration) {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  return result;
}

// ---------------------------------------------------------------------------
// Byte helpers shared by the WebM and MP4 builders.

type Bytes = Uint8Array | number[];

function concat(parts: Bytes[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function uintBytes(value: number, length: number): number[] {
  const out: number[] = new Array(length).fill(0);
  let rest = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    out[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  return out;
}

const ascii = (text: string): Bytes => [...text].map((char) => char.charCodeAt(0));

// ---------------------------------------------------------------------------
// WebM builder (EBML), close to what MediaRecorder writes.

function ebmlId(id: number): number[] {
  const out: number[] = [];
  let rest = id;
  while (rest > 0) {
    out.unshift(rest % 256);
    rest = Math.floor(rest / 256);
  }
  return out;
}

function ebmlSize(size: number): number[] {
  for (let length = 1; length <= 8; length += 1) {
    if (size < 2 ** (7 * length) - 1) {
      const out = uintBytes(size, length);
      out[0] |= 0x80 >> (length - 1);
      return out;
    }
  }
  throw new Error("size");
}

const UNKNOWN_SIZE = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

function el(id: number, ...children: Bytes[]): Uint8Array {
  const data = concat(children);
  return concat([ebmlId(id), ebmlSize(data.length), data]);
}

function elUnknown(id: number, ...children: Bytes[]): Uint8Array {
  return concat([ebmlId(id), UNKNOWN_SIZE, concat(children)]);
}

const uintEl = (id: number, value: number, length = 4) => el(id, uintBytes(value, length));
const strEl = (id: number, text: string) => el(id, ascii(text));

const ID = {
  EBML: 0x1a45dfa3,
  DocType: 0x4282,
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Duration: 0x4489,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  Audio: 0xe1,
  Channels: 0x9f,
  ContentEncodings: 0x6d80,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  BlockDuration: 0x9b,
  BlockAdditions: 0x75a1,
  Cues: 0x1c53bb6b,
  Attachments: 0x1941a469,
  Void: 0xec,
};

/** Opus packet: TOC byte (config, code), frame count for code 3, filler. */
function opus(config: number, code = 0, frames = 1): Bytes {
  if (code === 3) return [(config << 3) | 3, frames, 0xaa];
  if (code === 1) return [(config << 3) | 1, 0xaa, 0xaa];
  return [(config << 3) | code, 0xaa, 0xaa];
}

function opusHead(channels = 1): Bytes {
  return concat([ascii("OpusHead"), [1, channels], [0x38, 0x01], uintBytes(48000, 4).reverse(), [0, 0, 0]]);
}

function trackEntry(options: {
  number?: number;
  type?: number;
  codec?: string;
  channels?: number;
  extra?: Bytes[];
} = {}): Bytes {
  const channels = options.channels ?? 1;
  return el(
    ID.TrackEntry,
    uintEl(ID.TrackNumber, options.number ?? 1, 1),
    uintEl(ID.TrackType, options.type ?? 2, 1),
    strEl(ID.CodecID, options.codec ?? "A_OPUS"),
    el(ID.CodecPrivate, opusHead(channels)),
    el(ID.Audio, uintEl(ID.Channels, channels, 1)),
    ...(options.extra ?? [])
  );
}

type Block = { at: number; packet: Bytes; track?: number; flags?: number; group?: Bytes[] };

function simpleBlock(clusterAt: number, block: Block): Bytes {
  const rel = block.at - clusterAt;
  const header = [0x80 | (block.track ?? 1), (rel >> 8) & 0xff, rel & 0xff, block.flags ?? 0x80];
  if (block.group) {
    return el(ID.BlockGroup, el(ID.Block, header, block.packet), ...block.group);
  }
  return el(ID.SimpleBlock, header, block.packet);
}

type WebmOptions = {
  blocks: Block[];
  docType?: string;
  unknownSizes?: boolean;
  timecodeScale?: number;
  durationMs?: number;
  tracks?: Bytes[];
  beforeClusters?: Bytes[];
  afterClusters?: Bytes[];
  clusterTimecodeShift?: number;
  clusterExtra?: Bytes[];
  noTimecode?: boolean;
  trailing?: Bytes;
};

function buildWebm(options: WebmOptions): Uint8Array {
  const header = el(ID.EBML, uintEl(0x4286, 1, 1), uintEl(0x42f7, 1, 1), uintEl(0x42f2, 4, 1), uintEl(0x42f3, 8, 1), strEl(ID.DocType, options.docType ?? "webm"), uintEl(0x4287, 4, 1), uintEl(0x4285, 2, 1));
  const info = el(
    ID.Info,
    uintEl(ID.TimecodeScale, options.timecodeScale ?? 1_000_000, 3),
    ...(options.durationMs === undefined ? [] : [el(ID.Duration, (() => { const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, options.durationMs); return [...new Uint8Array(view.buffer)]; })())])
  );
  const tracks = el(ID.Tracks, ...(options.tracks ?? [trackEntry()]));
  // Clusters of up to 30 s, as relative block timecodes are int16 (ms).
  const clusters: Bytes[] = [];
  let index = 0;
  while (index < options.blocks.length) {
    const clusterAt = options.blocks[index].at;
    const members: Bytes[] = [];
    while (index < options.blocks.length && options.blocks[index].at - clusterAt < 30_000) {
      members.push(simpleBlock(clusterAt, options.blocks[index]));
      index += 1;
    }
    const timecode = options.noTimecode
      ? []
      : uintEl(ID.Timecode, clusterAt + (options.clusterTimecodeShift ?? 0), 8);
    const body = concat([timecode, ...(options.clusterExtra ?? []), ...members]);
    clusters.push(options.unknownSizes ? elUnknown(ID.Cluster, body) : el(ID.Cluster, body));
  }
  const segmentBody = concat([...(options.beforeClusters ?? []), info, tracks, ...clusters, ...(options.afterClusters ?? [])]);
  const segment = options.unknownSizes ? elUnknown(ID.Segment, segmentBody) : el(ID.Segment, segmentBody);
  return concat([header, segment, options.trailing ?? []]);
}

/** Blocks for `seconds` of audio made of packets of `packetMs` (Opus config). */
function opusBlocks(seconds: number, packetMs = 20, config = 31, spacingMs = packetMs): Block[] {
  const count = Math.round((seconds * 1000) / packetMs);
  return Array.from({ length: count }, (_, i) => ({ at: Math.round(i * spacingMs), packet: opus(config) }));
}

// ---------------------------------------------------------------------------
// Fragmented MP4 builder (ISO BMFF), close to what WebKit writes.

function box(type: string, ...payload: Bytes[]): Uint8Array {
  const data = concat(payload);
  return concat([uintBytes(8 + data.length, 4), ascii(type), data]);
}

const fullBox = (type: string, version: number, flags: number, ...payload: Bytes[]) =>
  box(type, [version, ...uintBytes(flags, 3)], ...payload);

function audioSpecificConfig(options: { aot?: number; rateIndex?: number; channels?: number; frameLengthFlag?: number; sbr?: boolean } = {}): Bytes {
  const bits = [
    [options.aot ?? 2, 5],
    [options.rateIndex ?? 4, 4],
    [options.channels ?? 2, 4],
    [options.frameLengthFlag ?? 0, 1],
    [0, 1],
    [0, 1],
    ...(options.sbr ? [[0x2b7, 11], [5, 5], [1, 1], [0, 4]] : []),
  ];
  const flat: number[] = [];
  for (const [field, width] of bits) {
    for (let i = width - 1; i >= 0; i -= 1) flat.push(Math.floor(field / 2 ** i) % 2);
  }
  while (flat.length % 8 !== 0) flat.push(0);
  const out: number[] = [];
  for (let i = 0; i < flat.length; i += 8) {
    out.push(flat.slice(i, i + 8).reduce((byte, bit) => byte * 2 + bit, 0));
  }
  return out;
}

function descriptor(tag: number, payload: Bytes): Bytes {
  return [tag, 0x80, 0x80, 0x80, payload.length, ...payload];
}

function esds(asc: Bytes, objectType = 0x40, streamType = 0x15): Bytes {
  const config = descriptor(0x04, [objectType, streamType, 0, 0x18, 0, ...uintBytes(0, 4), ...uintBytes(0x2ee00, 4), ...descriptor(0x05, asc)]);
  return fullBox("esds", 0, 0, descriptor(0x03, [0, 0, 0, ...config, ...descriptor(0x06, [2])]));
}

function mp4a(options: { asc?: Bytes; channels?: number; version?: number; children?: Bytes[]; type?: string } = {}): Bytes {
  return box(
    options.type ?? "mp4a",
    [0, 0, 0, 0, 0, 0, 0, 1],
    uintBytes(options.version ?? 0, 2),
    [0, 0, 0, 0, 0, 0],
    uintBytes(options.channels ?? 2, 2),
    uintBytes(16, 2),
    [0, 0, 0, 0],
    uintBytes(44100 * 65536, 4),
    ...(options.children ?? [esds(options.asc ?? audioSpecificConfig())])
  );
}

type MoovOptions = {
  entry?: Bytes;
  entries?: Bytes[];
  handler?: string;
  timescale?: number;
  trackId?: number;
  elst?: Bytes | null;
  extraTrak?: Bytes[];
  tracks?: number;
  stblExtra?: Bytes[];
  stsz?: Bytes;
  noMvex?: boolean;
};

function moov(options: MoovOptions = {}): Bytes {
  const trackId = options.trackId ?? 1;
  const timescale = options.timescale ?? 44100;
  const entries = options.entries ?? [options.entry ?? mp4a()];
  const stbl = box(
    "stbl",
    fullBox("stsd", 0, 0, uintBytes(entries.length, 4), ...entries),
    fullBox("stts", 0, 0, uintBytes(0, 4)),
    fullBox("stsc", 0, 0, uintBytes(0, 4)),
    options.stsz ?? fullBox("stsz", 0, 0, uintBytes(0, 4), uintBytes(0, 4)),
    fullBox("stco", 0, 0, uintBytes(0, 4)),
    ...(options.stblExtra ?? [])
  );
  const elst =
    options.elst === null
      ? []
      : box("edts", options.elst ?? fullBox("elst", 0, 0, uintBytes(1, 4), uintBytes(0, 4), uintBytes(2112, 4), uintBytes(0x10000, 4)));
  const trak = box(
    "trak",
    fullBox("tkhd", 0, 1, uintBytes(0, 8), uintBytes(trackId, 4), new Array(68).fill(0)),
    elst,
    box(
      "mdia",
      fullBox("mdhd", 0, 0, uintBytes(0, 8), uintBytes(timescale, 4), uintBytes(0, 4), [0x55, 0xc4, 0, 0]),
      fullBox("hdlr", 0, 0, uintBytes(0, 4), ascii(options.handler ?? "soun"), new Array(12).fill(0), [0]),
      box("minf", fullBox("smhd", 0, 0, [0, 0, 0, 0]), box("dinf", fullBox("dref", 0, 0, uintBytes(1, 4), fullBox("url ", 0, 1))), stbl)
    ),
    ...(options.extraTrak ?? [])
  );
  const traks = Array.from({ length: options.tracks ?? 1 }, () => trak);
  const mvex = options.noMvex ? [] : box("mvex", fullBox("trex", 0, 0, uintBytes(trackId, 4), uintBytes(1, 4), uintBytes(0, 4), uintBytes(0, 4), uintBytes(0, 4)));
  return box("moov", fullBox("mvhd", 0, 0, new Array(96).fill(0)), ...traks, mvex);
}

type FragmentOptions = {
  sizes: number[];
  sampleDuration?: number;
  durations?: number[];
  tfdt?: number | null;
  trackId?: number;
  tfhdFlags?: number;
  trunFlags?: number;
  dataOffsetDelta?: number;
  mdatExtra?: number;
  trafExtra?: Bytes[];
  countOverride?: number;
};

/** One moof + mdat pair; data_offset points at the mdat payload. */
function fragment(options: FragmentOptions): Bytes {
  const trunFlags = options.trunFlags ?? (0x000001 | 0x000200 | (options.durations ? 0x000100 : 0));
  const build = (dataOffset: number) => {
    const samples = options.sizes.flatMap((size, i) => [
      ...(trunFlags & 0x000100 ? uintBytes(options.durations?.[i] ?? 1024, 4) : []),
      ...(trunFlags & 0x000200 ? uintBytes(size, 4) : []),
    ]);
    const trun = fullBox("trun", 0, trunFlags, uintBytes(options.countOverride ?? options.sizes.length, 4), trunFlags & 0x000001 ? uintBytes(dataOffset, 4) : [], samples);
    const tfhdFlags = options.tfhdFlags ?? 0x020008;
    const tfhd = fullBox("tfhd", 0, tfhdFlags, uintBytes(options.trackId ?? 1, 4), tfhdFlags & 0x000008 ? uintBytes(options.sampleDuration ?? 1024, 4) : []);
    const tfdt = options.tfdt === null ? [] : fullBox("tfdt", 1, 0, uintBytes(options.tfdt ?? 0, 8));
    return box("moof", fullBox("mfhd", 0, 0, uintBytes(1, 4)), box("traf", tfhd, tfdt, trun, ...(options.trafExtra ?? [])));
  };
  const moofLength = build(0).length;
  const payload = new Uint8Array(options.sizes.reduce((sum, size) => sum + size, 0) + (options.mdatExtra ?? 0)).fill(0x21);
  return concat([build(moofLength + 8 + (options.dataOffsetDelta ?? 0)), box("mdat", payload)]);
}

const ftyp = () => box("ftyp", ascii("iso5"), uintBytes(1, 4), ascii("isom"), ascii("iso5"));

function buildMp4(options: { moov?: Bytes; fragments: Bytes[]; before?: Bytes[]; after?: Bytes[] }): Uint8Array {
  return concat([ftyp(), ...(options.before ?? []), options.moov ?? moov(), ...options.fragments, ...(options.after ?? [])]);
}

/** AAC fragments for `seconds` at 44.1 kHz (1024 samples per access unit). */
function aacFragments(seconds: number, perFragment = 430, sampleRate = 44100): Bytes[] {
  const total = Math.ceil((seconds * sampleRate) / 1024);
  const out: Bytes[] = [];
  for (let start = 0; start < total; start += perFragment) {
    const count = Math.min(perFragment, total - start);
    out.push(fragment({ sizes: new Array(count).fill(6), tfdt: start * 1024 }));
  }
  return out;
}

// ---------------------------------------------------------------------------

describe("Opus packet duration (RFC 6716, 3.1)", () => {
  it("reads the frame size of every TOC configuration", () => {
    const expected = [10, 20, 40, 60, 10, 20, 40, 60, 10, 20, 40, 60, 10, 20, 10, 20, 2.5, 5, 10, 20, 2.5, 5, 10, 20, 2.5, 5, 10, 20, 2.5, 5, 10, 20];
    for (let config = 0; config < 32; config += 1) {
      assert.equal(opusPacketMicros(Uint8Array.from(opus(config))), expected[config] * 1000, `config ${config}`);
    }
  });

  it("counts the frames of codes 1, 2 and 3", () => {
    assert.equal(opusPacketMicros(Uint8Array.from(opus(31, 1))), 40_000);
    assert.equal(opusPacketMicros(Uint8Array.from(opus(31, 2))), 40_000);
    assert.equal(opusPacketMicros(Uint8Array.from(opus(31, 3, 6))), 120_000);
    assert.equal(opusPacketMicros(Uint8Array.from(opus(16, 3, 48))), 120_000);
  });

  it("rejects invalid packets", () => {
    assert.equal(opusPacketMicros(new Uint8Array()), null);
    assert.equal(opusPacketMicros(Uint8Array.from([(31 << 3) | 1, 0])), null, "code 1, odd payload");
    assert.equal(opusPacketMicros(Uint8Array.from([(31 << 3) | 2])), null, "code 2 without length");
    assert.equal(opusPacketMicros(Uint8Array.from([(31 << 3) | 3])), null, "code 3 without count");
    assert.equal(opusPacketMicros(Uint8Array.from(opus(31, 3, 0))), null, "code 3, zero frames");
    assert.equal(opusPacketMicros(Uint8Array.from(opus(3, 3, 3))), null, "180 ms > 120 ms");
  });
});

describe("real MediaRecorder recordings (tone, no voice)", () => {
  // Recorded with Playwright 1.58.2 (see the fixtures README). Packet counts
  // cross-checked with Mediabunny 1.61.3; durations are codec-based here.
  const accepted = [
    { name: "chromium-145-3s.webm", container: "webm", codec: "opus", packets: 48, seconds: 2.88 },
    { name: "firefox-146-3s.webm", container: "webm", codec: "opus", packets: 151, seconds: 3.02 },
    { name: "webkit-26-3s.webm", container: "webm", codec: "opus", packets: 1150, seconds: 2.875 },
    { name: "webkit-26-3s-aac.mp4", container: "mp4", codec: "aac", packets: 125, seconds: (125 * 1024) / 44100 },
  ];

  for (const sample of accepted) {
    it(`measures ${sample.name}`, () => {
      const result = assertAccepted(measure(fixture(sample.name)));
      assert.equal(result.container, sample.container);
      assert.equal(result.codec, sample.codec);
      assert.equal(result.packets, sample.packets);
      assert.ok(Math.abs(result.seconds - sample.seconds) < 0.001, `${result.seconds}`);
      assert.ok(Math.abs(result.timelineSeconds - result.seconds) < 0.1, `${result.timelineSeconds}`);
      assertRejected(measure(fixture(sample.name), sample.seconds - 0.5), "too_long");
    });
  }

  it("rejects the containers and codecs the app does not record", () => {
    assertRejected(measure(fixture("chromium-145-3s-opus.mp4")), "unsupported", "mp4_codec_Opus");
    assertRejected(measure(fixture("firefox-146-3s.ogg")), "unsupported", "container");
  });

  it("keeps the slowest real recording far below the byte cap", () => {
    // WebKit AAC ignores the 48 kbps request: 59 s weighed 1,091,808 bytes.
    const cap = maxAudioBytesForClip(DEFAULT_MAX_CLIP_SECONDS, DEFAULT_MAX_AUDIO_BYTES);
    assert.ok(1_091_808 * (61 / 59) < cap);
    for (const sample of accepted) {
      const bytesPerSecond = fixture(sample.name).length / sample.seconds;
      assert.ok(bytesPerSecond * LIMIT < cap, sample.name);
    }
  });
});

describe("clip length limit", () => {
  it("accepts up to max_clip_seconds plus the tolerance, in WebM and MP4", () => {
    for (const unknownSizes of [false, true]) {
      assert.equal(assertAccepted(measure(buildWebm({ blocks: opusBlocks(59), unknownSizes }))).seconds, 59);
      assert.equal(assertAccepted(measure(buildWebm({ blocks: opusBlocks(60.9), unknownSizes }))).seconds, 60.9);
      assertRejected(measure(buildWebm({ blocks: opusBlocks(61.5), unknownSizes })), "too_long", "decoded");
    }
    assert.ok(assertAccepted(measure(buildMp4({ fragments: aacFragments(59) }))).seconds < 59.1);
    assertRejected(measure(buildMp4({ fragments: aacFragments(62) })), "too_long", "decoded");
  });

  it("counts WebKit's 2.5 ms packets and scales the packet cap with the limit", () => {
    assert.equal(assertAccepted(measure(buildWebm({ blocks: opusBlocks(60, 2.5, 16), unknownSizes: true }))).packets, 24_000);
    assert.equal(maxAudioPackets(LIMIT), 24_500);
    const longClip = buildWebm({ blocks: opusBlocks(290, 2.5, 16), unknownSizes: true });
    assert.equal(assertAccepted(measure(longClip, 301)).packets, 116_000);
  });

  it("ignores the metadata duration in both directions", () => {
    assertRejected(measure(buildWebm({ blocks: opusBlocks(120), durationMs: 5_000 })), "too_long");
    assert.equal(assertAccepted(measure(buildWebm({ blocks: opusBlocks(5), durationMs: 600_000 }))).seconds, 5);
  });
});

describe("adversarial WebM", () => {
  it("does not trust timestamps that hide packets", () => {
    const blocks = opusBlocks(120).map((block) => ({ ...block, at: 0 }));
    assertRejected(measure(buildWebm({ blocks })), "too_long", "decoded");
  });

  it("rejects long audio squeezed under the byte cap", () => {
    // 1-byte Opus packets (2.5 ms): 6 minutes would fit in the byte cap.
    const blocks = Array.from({ length: 144_000 }, (_, i) => ({ at: Math.floor(i * 2.5), packet: [16 << 3] }));
    const clip = buildWebm({ blocks, unknownSizes: true });
    assert.ok(clip.length < maxAudioBytesForClip(DEFAULT_MAX_CLIP_SECONDS, DEFAULT_MAX_AUDIO_BYTES));
    assertRejected(measure(clip), "too_long");
  });

  it("rejects audio spread over a longer timeline", () => {
    assertRejected(measure(buildWebm({ blocks: opusBlocks(30, 20, 31, 400) })), "too_long", "timeline");
    assertRejected(measure(buildWebm({ blocks: opusBlocks(1), clusterTimecodeShift: 2 ** 40 })), "too_long", "timeline");
    const longGroup = [{ at: 0, packet: opus(31), group: [uintEl(ID.BlockDuration, 120_000)] }];
    assertRejected(measure(buildWebm({ blocks: longGroup })), "too_long", "timeline");
  });

  it("rejects extra tracks, other codecs and other documents", () => {
    assertRejected(measure(buildWebm({ blocks: opusBlocks(1), tracks: [trackEntry(), trackEntry({ number: 2 })] })), "unsupported", "webm_tracks");
    assertRejected(measure(buildWebm({ blocks: opusBlocks(1), tracks: [trackEntry({ type: 1 })] })), "unsupported", "webm_track_type");
    assertRejected(measure(buildWebm({ blocks: opusBlocks(1), tracks: [trackEntry({ codec: "A_VORBIS" })] })), "unsupported", "webm_codec");
    assertRejected(measure(buildWebm({ blocks: opusBlocks(1), tracks: [trackEntry({ channels: 6 })] })), "unsupported");
    assertRejected(measure(buildWebm({ blocks: opusBlocks(1), tracks: [trackEntry({ extra: [el(ID.ContentEncodings)] })] })), "unsupported", "webm_track_child");
    assertRejected(measure(buildWebm({ blocks: opusBlocks(1), docType: "matroska" })), "unsupported", "webm_doctype");
  });

  it("rejects blocks for another track, lacing and block additions", () => {
    assertRejected(measure(buildWebm({ blocks: [{ at: 0, packet: opus(31), track: 2 }] })), "unsupported", "webm_block_track");
    assertRejected(measure(buildWebm({ blocks: [{ at: 0, packet: opus(31), flags: 0x82 }] })), "unsupported", "webm_lacing");
    const additions = [{ at: 0, packet: opus(31), group: [el(ID.BlockAdditions, [0])] }];
    assertRejected(measure(buildWebm({ blocks: additions })), "unsupported", "webm_block_group_child");
  });

  it("rejects attachments, unknown elements and concatenated files", () => {
    assertRejected(measure(buildWebm({ blocks: opusBlocks(1), afterClusters: [el(ID.Attachments, [0])] })), "unsupported", "webm_segment_child");
    assertRejected(measure(buildWebm({ blocks: opusBlocks(1), clusterExtra: [el(0x4dbb, [0])] })), "unsupported", "webm_cluster_child");
    const second = buildWebm({ blocks: opusBlocks(50) });
    assertRejected(measure(concat([buildWebm({ blocks: opusBlocks(20), unknownSizes: true }), second])), "unsupported", "webm_segment_child");
  });

  it("rejects structural errors", () => {
    assertRejected(measure(buildWebm({ blocks: opusBlocks(1), noTimecode: true })), "malformed", "webm_block_before_timecode");
    assertRejected(measure(buildWebm({ blocks: [{ at: 0, packet: [] }] })), "malformed", "opus_packet");
    assertRejected(measure(buildWebm({ blocks: [{ at: 0, packet: opus(31, 3, 0) }] })), "malformed", "opus_packet");
    assertRejected(measure(buildWebm({ blocks: [] })), "malformed", "no_packets");
    assertRejected(measure(buildWebm({ blocks: opusBlocks(1), beforeClusters: [], tracks: [] })), "unsupported", "webm_tracks");
    assertRejected(measure(buildWebm({ blocks: opusBlocks(1), trailing: [0, 0, 0, 0] })), "malformed", "trailing_bytes");
  });
});

describe("adversarial MP4", () => {
  it("counts access units, not the durations the fragments declare", () => {
    const fragments = [fragment({ sizes: new Array(6000).fill(6), sampleDuration: 1 })];
    assertRejected(measure(buildMp4({ fragments })), "too_long", "decoded");
    const declaredLong = [fragment({ sizes: new Array(10).fill(6), sampleDuration: 44100 * 10 })];
    assertRejected(measure(buildMp4({ fragments: declaredLong })), "too_long", "timeline");
    assertRejected(measure(buildMp4({ fragments: [fragment({ sizes: [6], tfdt: 44100 * 3600 })] })), "too_long", "timeline");
  });

  it("uses the 960-sample frame length when the config says so", () => {
    const entry = mp4a({ asc: audioSpecificConfig({ frameLengthFlag: 1 }) });
    const result = assertAccepted(measure(buildMp4({ moov: moov({ entry }), fragments: [fragment({ sizes: new Array(441).fill(6) })] })));
    assert.equal(result.seconds, (441 * 960) / 44100);
  });

  it("accepts AAC-LC only, mono or stereo, at 48 kHz or less", () => {
    const run = (asc: Bytes) => measure(buildMp4({ moov: moov({ entry: mp4a({ asc }) }), fragments: [fragment({ sizes: [6] })] }));
    assert.equal(run(audioSpecificConfig({ rateIndex: 3, channels: 1 })).ok, true);
    assertRejected(run(audioSpecificConfig({ aot: 5 })), "unsupported", "aac_profile");
    assertRejected(run(audioSpecificConfig({ aot: 29 })), "unsupported", "aac_profile");
    assertRejected(run(audioSpecificConfig({ sbr: true })), "unsupported", "aac_sbr");
    assertRejected(run(audioSpecificConfig({ rateIndex: 0 })), "unsupported", "aac_sample_rate");
    assertRejected(run(audioSpecificConfig({ channels: 0 })), "unsupported", "aac_channels");
    assertRejected(run(audioSpecificConfig({ channels: 6 })), "unsupported", "aac_channels");
    const mp3 = measure(buildMp4({ moov: moov({ entry: mp4a({ children: [esds(audioSpecificConfig(), 0x6b)] }) }), fragments: [fragment({ sizes: [6] })] }));
    assertRejected(mp3, "unsupported", "mp4_object_type");
  });

  it("rejects other tracks, codecs, encryption and old sound descriptions", () => {
    const one = [fragment({ sizes: [6] })];
    assertRejected(measure(buildMp4({ moov: moov({ tracks: 2 }), fragments: one })), "unsupported", "mp4_tracks");
    assertRejected(measure(buildMp4({ moov: moov({ handler: "vide" }), fragments: one })), "unsupported", "mp4_handler");
    assertRejected(measure(buildMp4({ moov: moov({ entry: mp4a({ type: "enca" }) }), fragments: one })), "unsupported", "mp4_codec_enca");
    assertRejected(measure(buildMp4({ moov: moov({ entry: mp4a({ version: 1 }) }), fragments: one })), "unsupported", "mp4_sound_version");
    assertRejected(measure(buildMp4({ moov: moov({ entries: [mp4a(), mp4a()] }), fragments: one })), "unsupported", "mp4_stsd");
    assertRejected(measure(buildMp4({ moov: moov({ extraTrak: [box("tref", [0])] }), fragments: one })), "unsupported", "mp4_trak_child");
    assertRejected(measure(buildMp4({ moov: moov({ stblExtra: [box("saiz", [0])] }), fragments: one })), "unsupported", "mp4_stbl_child");
  });

  it("rejects edit lists that add time", () => {
    const one = [fragment({ sizes: [6] })];
    const empty = fullBox("elst", 0, 0, uintBytes(1, 4), uintBytes(44100, 4), [0xff, 0xff, 0xff, 0xff], uintBytes(0x10000, 4));
    assertRejected(measure(buildMp4({ moov: moov({ elst: empty }), fragments: one })), "unsupported", "mp4_empty_edit");
    const two = fullBox("elst", 0, 0, uintBytes(2, 4), uintBytes(0, 4), uintBytes(0, 4), uintBytes(0x10000, 4), uintBytes(0, 4), uintBytes(0, 4), uintBytes(0x10000, 4));
    assertRejected(measure(buildMp4({ moov: moov({ elst: two }), fragments: one })), "unsupported", "mp4_edits");
    const slow = fullBox("elst", 0, 0, uintBytes(1, 4), uintBytes(0, 4), uintBytes(0, 4), uintBytes(0x8000, 4));
    assertRejected(measure(buildMp4({ moov: moov({ elst: slow }), fragments: one })), "unsupported", "mp4_edit_rate");
  });

  it("rejects non-fragmented files (not recorded by any supported browser)", () => {
    const stsz = fullBox("stsz", 0, 0, uintBytes(6, 4), uintBytes(10, 4));
    assertRejected(measure(buildMp4({ moov: moov({ stsz }), fragments: [] })), "unsupported", "mp4_non_fragmented");
    assertRejected(measure(buildMp4({ moov: moov({ noMvex: true }), fragments: [] })), "unsupported", "mp4_non_fragmented");
  });

  it("requires every mdat byte to belong to a sample, in order", () => {
    assertRejected(measure(buildMp4({ fragments: [fragment({ sizes: [6, 6], mdatExtra: 4096 })] })), "malformed", "mp4_mdat_unaccounted");
    assertRejected(measure(buildMp4({ fragments: [fragment({ sizes: [6, 6], dataOffsetDelta: 4 })] })), "malformed", "mp4_data_offset");
    assertRejected(measure(buildMp4({ fragments: [fragment({ sizes: [6], trunFlags: 0x000200 })] })), "malformed", "mp4_data_offset");
    assertRejected(measure(buildMp4({ fragments: [fragment({ sizes: [6, 0] })] })), "malformed", "mp4_sample_size");
    const moofOnly = fragment({ sizes: [6] });
    const withoutMdat = moofOnly.slice(0, moofOnly.length - 14);
    assertRejected(measure(buildMp4({ fragments: [withoutMdat] })), "malformed");
    assertRejected(measure(buildMp4({ fragments: [box("mdat", [1, 2, 3])] })), "malformed", "mp4_mdat_without_moof");
  });

  it("checks declared counts against the box size before trusting them", () => {
    const started = performance.now();
    assertRejected(measure(buildMp4({ fragments: [fragment({ sizes: [6], countOverride: 0x7fffffff })] })), "malformed", "mp4_trun_size");
    assert.ok(performance.now() - started < 50);
  });

  it("rejects unknown flags, top-level boxes and trailing bytes", () => {
    assertRejected(measure(buildMp4({ fragments: [fragment({ sizes: [6], tfhdFlags: 0x020009 })] })), "unsupported", "mp4_tfhd_flags");
    assertRejected(measure(buildMp4({ fragments: [fragment({ sizes: [6], trunFlags: 0x000a01 })] })), "unsupported", "mp4_trun_flags");
    assertRejected(measure(buildMp4({ fragments: [fragment({ sizes: [6], trackId: 2 })] })), "malformed", "mp4_tfhd_track");
    assertRejected(measure(buildMp4({ fragments: [fragment({ sizes: [6], trafExtra: [box("senc", [0])] })] })), "unsupported", "mp4_traf_child");
    assertRejected(measure(buildMp4({ fragments: [fragment({ sizes: [6] })], after: [box("uuid", new Array(16).fill(1))] })), "unsupported", "mp4_top_level");
    assertRejected(measure(buildMp4({ fragments: [fragment({ sizes: [6] })], after: [[0, 0, 0]] })), "malformed");
  });
});

describe("robustness", () => {
  const samples = ["chromium-145-3s.webm", "firefox-146-3s.webm", "webkit-26-3s.webm", "webkit-26-3s-aac.mp4"];

  it("rejects trailing garbage or zeros quickly (a library hung on this)", () => {
    const garbage = Array.from({ length: 4096 }, (_, i) => (i * 37) & 255);
    for (const name of samples) {
      for (const tail of [garbage, new Array(4096).fill(0)]) {
        const started = performance.now();
        const result = measure(concat([fixture(name), tail]));
        assert.equal(result.ok, false, name);
        assert.ok(performance.now() - started < 50, name);
      }
    }
  });

  it("never accepts a truncated recording as longer than the original", () => {
    for (const name of samples) {
      const bytes = fixture(name);
      const full = assertAccepted(measure(bytes));
      for (let cut = 0; cut < bytes.length; cut += 97) {
        const result = measure(bytes.subarray(0, cut));
        if (result.ok) assert.ok(result.seconds <= full.seconds, `${name} cut at ${cut}`);
      }
    }
  });

  it("survives seeded random mutations within the limits", () => {
    let seed = 0x9e3779b9;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let slowest = 0;
    for (const name of samples) {
      const original = fixture(name);
      for (let round = 0; round < 400; round += 1) {
        const bytes = Uint8Array.from(original);
        const edits = 1 + Math.floor(random() * 8);
        for (let i = 0; i < edits; i += 1) {
          bytes[Math.floor(random() * bytes.length)] = Math.floor(random() * 256);
        }
        const cut = random() < 0.2 ? Math.floor(random() * bytes.length) : bytes.length;
        const started = performance.now();
        const result = measure(bytes.subarray(0, cut));
        slowest = Math.max(slowest, performance.now() - started);
        if (result.ok) {
          assert.ok(result.seconds <= LIMIT && result.timelineSeconds <= LIMIT, name);
          assert.ok(result.packets <= maxAudioPackets(LIMIT), name);
        }
      }
    }
    assert.ok(slowest < 100, `slowest ${slowest} ms`);
  });

  it("stays fast on 3 MB worst cases", () => {
    const cases = [
      buildWebm({ blocks: Array.from({ length: 400_000 }, (_, i) => ({ at: Math.floor(i * 2.5), packet: [16 << 3] })), unknownSizes: true }),
      concat([buildWebm({ blocks: opusBlocks(1), unknownSizes: true }), new Uint8Array(3_000_000).fill(0xec)]),
      buildMp4({ fragments: [fragment({ sizes: new Array(200_000).fill(6) })] }),
    ];
    for (const bytes of cases) {
      const started = performance.now();
      assert.equal(measure(bytes).ok, false);
      assert.ok(performance.now() - started < 250, `${performance.now() - started} ms`);
    }
  });

  it("never throws, whatever the input", () => {
    for (const bytes of [new Uint8Array(), Uint8Array.from([0x1a]), Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]), Uint8Array.from(ascii("....ftyp"))]) {
      assert.equal(measure(bytes).ok, false);
    }
    assertRejected(measureAudioDuration(fixture("firefox-146-3s.webm"), { maxSeconds: Number.NaN }), "too_long", "invalid_limit");
  });
});

describe("transcription route", () => {
  it("measures the duration after the byte cap and before the provider and the ledger", () => {
    const route = readFileSync(path.join(process.cwd(), "app/api/ai/voice-orders/transcriptions/route.ts"), "utf8");
    const at = (needle: string) => {
      const index = route.indexOf(needle);
      assert.ok(index >= 0, needle);
      return index;
    };
    assert.ok(at("bytes.byteLength > maxBytes") < at("validateAudioBytes(bytes"));
    assert.ok(at("validateAudioBytes(bytes") < at("measureAudioDuration(bytes"));
    assert.ok(at("measureAudioDuration(bytes") < at("getTranscriptionProvider()"));
    assert.ok(at("measureAudioDuration(bytes") < at("reserveAiUsage("));
    assert.match(route, /maxSeconds: maxClip \+ CLIP_DURATION_TOLERANCE_SECONDS/);
    assert.match(route, /code: "audio_too_long"/);
  });
});
