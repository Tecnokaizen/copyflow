/**
 * Server-side duration of a recorded voice clip (G2 audit, M2), measured
 * from the codec packets the provider will decode, not from the container
 * metadata: MediaRecorder writes it inconsistently (Firefox Duration 0,
 * WebKit none, Chrome off by ~60 ms) and the client controls it anyway.
 *
 * Supported, and nothing else:
 * - WebM + Opus (Chrome, Edge, Firefox, Safari 18.4+): sum of the duration
 *   each Opus packet's TOC byte declares (RFC 6716, section 3.1);
 * - fragmented MP4 + AAC-LC (older Safari): access units x 1024 (or 960)
 *   samples / sampling rate from the AudioSpecificConfig.
 * Container timestamps are a second upper bound: they can only reject.
 *
 * Fail-closed and strict on purpose: one audio track, no lacing, no unknown
 * elements or boxes, every MP4 sample byte accounted for in its mdat, no
 * trailing bytes. Anything else is "unsupported" or "malformed". Work is
 * linear in the input (each step consumes bytes) and stops as soon as the
 * clip is over the limit; nothing is allocated from declared sizes.
 */

/** Recorder timer tick (200 ms), stop() flush and encoder framing. */
export const CLIP_DURATION_TOLERANCE_SECONDS = 1;

/**
 * Packets allowed for a clip: the shortest Opus packet lasts 2.5 ms (WebKit
 * records with it: 24,000 packets a minute), AAC frames at least 20 ms.
 */
export function maxAudioPackets(maxSeconds: number) {
  return Math.ceil(maxSeconds * 400) + 100;
}

export type AudioDurationFailure = "unsupported" | "malformed" | "too_long";

export type AudioDuration =
  | {
      ok: true;
      container: "webm" | "mp4";
      codec: "opus" | "aac";
      packets: number;
      /** Decoded duration: what the provider transcribes and bills. */
      seconds: number;
      /** End of the last packet on the container timeline. */
      timelineSeconds: number;
    }
  | { ok: false; reason: AudioDurationFailure; detail: string };

class AudioRejection extends Error {
  constructor(
    readonly reason: AudioDurationFailure,
    readonly detail: string
  ) {
    super(`${reason}:${detail}`);
  }
}

const unsupported = (detail: string) => new AudioRejection("unsupported", detail);
const malformed = (detail: string) => new AudioRejection("malformed", detail);
const tooLong = (detail: string) => new AudioRejection("too_long", detail);

function readUint(b: Uint8Array, offset: number, length: number, limit: number) {
  if (length < 0 || length > 8 || offset < 0 || offset + length > limit) {
    throw malformed("uint_bounds");
  }
  let value = 0;
  for (let i = 0; i < length; i += 1) {
    value = value * 256 + b[offset + i];
  }
  return value;
}

function ascii(b: Uint8Array, start: number, end: number) {
  let out = "";
  for (let i = start; i < end; i += 1) {
    out += String.fromCharCode(b[i]);
  }
  return out;
}

/** Hard caps on the work done for one clip, whatever the input claims. */
class Budget {
  private elements = 0;
  private readonly maxElements: number;
  private readonly maxPackets: number;
  packets = 0;

  constructor(maxSeconds: number) {
    this.maxPackets = maxAudioPackets(maxSeconds);
    this.maxElements = this.maxPackets * 2 + 10_000;
  }

  element() {
    this.elements += 1;
    if (this.elements > this.maxElements) {
      throw malformed("too_many_elements");
    }
  }

  packet(count = 1) {
    this.packets += count;
    if (this.packets > this.maxPackets) {
      throw tooLong("packets");
    }
  }
}

// ---------------------------------------------------------------------------
// Opus

/** Frame duration in microseconds for each TOC configuration (0–31). */
const OPUS_FRAME_MICROS = [
  10_000, 20_000, 40_000, 60_000, // SILK NB
  10_000, 20_000, 40_000, 60_000, // SILK MB
  10_000, 20_000, 40_000, 60_000, // SILK WB
  10_000, 20_000, // Hybrid SWB
  10_000, 20_000, // Hybrid FB
  2_500, 5_000, 10_000, 20_000, // CELT NB
  2_500, 5_000, 10_000, 20_000, // CELT WB
  2_500, 5_000, 10_000, 20_000, // CELT SWB
  2_500, 5_000, 10_000, 20_000, // CELT FB
];

/**
 * Decoded duration of one Opus packet in microseconds, or null when the
 * packet is invalid (RFC 6716, sections 3.1 and 3.2).
 */
export function opusPacketMicros(packet: Uint8Array): number | null {
  if (packet.length < 1) return null;
  const toc = packet[0];
  const frameMicros = OPUS_FRAME_MICROS[toc >> 3];
  const code = toc & 0x03;
  let frames: number;
  if (code === 0) {
    frames = 1;
  } else if (code === 1) {
    if ((packet.length - 1) % 2 !== 0) return null;
    frames = 2;
  } else if (code === 2) {
    if (packet.length < 2) return null;
    frames = 2;
  } else {
    if (packet.length < 2) return null;
    frames = packet[1] & 0x3f;
    if (frames === 0) return null;
  }
  const micros = frames * frameMicros;
  return micros > 120_000 ? null : micros;
}

// ---------------------------------------------------------------------------
// WebM (Matroska subset)

const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const SEEK_HEAD = 0x114d9b74;
const INFO = 0x1549a966;
const TRACKS = 0x1654ae6b;
const CLUSTER = 0x1f43b675;
const CUES = 0x1c53bb6b;
const TAGS = 0x1254c367;
const ATTACHMENTS = 0x1941a469;
const CHAPTERS = 0x1043a770;
const VOID = 0xec;
const TIMECODE_SCALE = 0x2ad7b1;
const TRACK_ENTRY = 0xae;
const TRACK_NUMBER = 0xd7;
const TRACK_TYPE = 0x83;
const CODEC_ID = 0x86;
const CODEC_PRIVATE = 0x63a2;
const AUDIO = 0xe1;
const CHANNELS = 0x9f;
const TIMECODE = 0xe7;
const SIMPLE_BLOCK = 0xa3;
const BLOCK_GROUP = 0xa0;
const BLOCK = 0xa1;
const BLOCK_DURATION = 0x9b;

const EBML_HEADER_CHILDREN = new Set([
  0x4286, // EBMLVersion
  0x42f7, // EBMLReadVersion
  0x42f2, // EBMLMaxIDLength
  0x42f3, // EBMLMaxSizeLength
  0x4282, // DocType
  0x4287, // DocTypeVersion
  0x4285, // DocTypeReadVersion
  VOID,
]);
const TRACK_ENTRY_CHILDREN = new Set([
  TRACK_NUMBER,
  0x73c5, // TrackUID
  TRACK_TYPE,
  0xb9, // FlagEnabled
  0x88, // FlagDefault
  0x55aa, // FlagForced
  0x9c, // FlagLacing
  0x6de7, // MinCache
  0x6df8, // MaxCache
  0x23e383, // DefaultDuration
  0x55ee, // MaxBlockAdditionID
  0x536e, // Name
  0x22b59c, // Language
  0x22b59d, // LanguageBCP47
  CODEC_ID,
  CODEC_PRIVATE,
  0x258688, // CodecName
  0x56aa, // CodecDelay
  0x56bb, // SeekPreRoll
  AUDIO,
  VOID,
]);
const AUDIO_CHILDREN = new Set([
  0xb5, // SamplingFrequency
  0x78b5, // OutputSamplingFrequency
  CHANNELS,
  0x6264, // BitDepth
  VOID,
]);
const CLUSTER_SKIPPED_CHILDREN = new Set([
  0xa7, // Position
  0xab, // PrevSize
  VOID,
]);
const BLOCK_GROUP_SKIPPED_CHILDREN = new Set([
  0xfa, // ReferencePriority
  0xfb, // ReferenceBlock
  0x75a2, // DiscardPadding
  0xa4, // CodecState
  VOID,
]);
/** Level-1 IDs (and a second EBML header) close an unknown-size Cluster. */
const CLOSES_CLUSTER = new Set([
  EBML,
  SEGMENT,
  SEEK_HEAD,
  INFO,
  TRACKS,
  CLUSTER,
  CUES,
  TAGS,
  ATTACHMENTS,
  CHAPTERS,
]);

type EbmlElement = {
  id: number;
  dataStart: number;
  dataEnd: number;
  unknownSize: boolean;
};

function readEbmlId(b: Uint8Array, offset: number, limit: number) {
  if (offset >= limit) throw malformed("webm_eof");
  const first = b[offset];
  const length =
    first & 0x80 ? 1 : first & 0x40 ? 2 : first & 0x20 ? 3 : first & 0x10 ? 4 : 0;
  if (length === 0) throw malformed("webm_id");
  return { id: readUint(b, offset, length, limit), length };
}

function readEbmlElement(b: Uint8Array, offset: number, limit: number): EbmlElement {
  const { id, length: idLength } = readEbmlId(b, offset, limit);
  const sizeOffset = offset + idLength;
  if (sizeOffset >= limit) throw malformed("webm_eof");
  const first = b[sizeOffset];
  let sizeLength = 1;
  let mask = 0x80;
  while (sizeLength <= 8 && (first & mask) === 0) {
    sizeLength += 1;
    mask >>= 1;
  }
  if (sizeLength > 8) throw malformed("webm_size");
  if (sizeOffset + sizeLength > limit) throw malformed("webm_eof");
  let size = first & (mask - 1);
  let allOnes = size === mask - 1;
  for (let i = 1; i < sizeLength; i += 1) {
    const byte = b[sizeOffset + i];
    size = size * 256 + byte;
    if (byte !== 0xff) allOnes = false;
  }
  const dataStart = sizeOffset + sizeLength;
  if (allOnes) {
    return { id, dataStart, dataEnd: limit, unknownSize: true };
  }
  if (size > limit - dataStart) throw malformed("webm_overflow");
  return { id, dataStart, dataEnd: dataStart + size, unknownSize: false };
}

function elementUint(b: Uint8Array, element: EbmlElement) {
  return readUint(b, element.dataStart, element.dataEnd - element.dataStart, element.dataEnd);
}

/** Known-size children of a known-size element, in order. */
function* ebmlChildren(b: Uint8Array, parent: EbmlElement, budget: Budget) {
  let offset = parent.dataStart;
  while (offset < parent.dataEnd) {
    budget.element();
    const child = readEbmlElement(b, offset, parent.dataEnd);
    if (child.unknownSize) throw malformed("webm_unknown_size");
    yield child;
    offset = child.dataEnd;
  }
}

type WebmState = {
  budget: Budget;
  maxMicros: number;
  maxNanos: number;
  timecodeScale: number;
  infoSeen: boolean;
  trackNumber: number | null;
  micros: number;
  timelineNanos: number;
};

function parseEbmlHeader(b: Uint8Array, header: EbmlElement, budget: Budget) {
  let docType: string | null = null;
  for (const child of ebmlChildren(b, header, budget)) {
    if (!EBML_HEADER_CHILDREN.has(child.id)) throw unsupported("webm_header_child");
    if (child.id === 0x4282) docType = ascii(b, child.dataStart, child.dataEnd);
    if (child.id === 0x42f7 && elementUint(b, child) !== 1) throw unsupported("webm_read_version");
    if (child.id === 0x42f2 && elementUint(b, child) > 4) throw unsupported("webm_id_length");
    if (child.id === 0x42f3 && elementUint(b, child) > 8) throw unsupported("webm_size_length");
    if (child.id === 0x4285 && elementUint(b, child) > 4) throw unsupported("webm_doctype_version");
  }
  if (docType !== "webm") throw unsupported("webm_doctype");
}

function parseTracks(b: Uint8Array, tracks: EbmlElement, state: WebmState) {
  let entries = 0;
  for (const child of ebmlChildren(b, tracks, state.budget)) {
    if (child.id === VOID) continue;
    if (child.id !== TRACK_ENTRY) throw unsupported("webm_tracks_child");
    entries += 1;
    if (entries > 1) throw unsupported("webm_tracks");

    let number: number | null = null;
    let type: number | null = null;
    let codec: string | null = null;
    for (const field of ebmlChildren(b, child, state.budget)) {
      if (!TRACK_ENTRY_CHILDREN.has(field.id)) throw unsupported("webm_track_child");
      if (field.id === TRACK_NUMBER) number = elementUint(b, field);
      if (field.id === TRACK_TYPE) type = elementUint(b, field);
      if (field.id === CODEC_ID) codec = ascii(b, field.dataStart, field.dataEnd);
      if (field.id === CODEC_PRIVATE) {
        // OpusHead: magic, version, channel count, ..., mapping family 0.
        const length = field.dataEnd - field.dataStart;
        if (length < 19 || ascii(b, field.dataStart, field.dataStart + 8) !== "OpusHead") {
          throw unsupported("webm_opus_head");
        }
        const channels = b[field.dataStart + 9];
        if (channels < 1 || channels > 2 || b[field.dataStart + 18] !== 0) {
          throw unsupported("webm_opus_channels");
        }
      }
      if (field.id === AUDIO) {
        for (const audio of ebmlChildren(b, field, state.budget)) {
          if (!AUDIO_CHILDREN.has(audio.id)) throw unsupported("webm_audio_child");
          if (audio.id === CHANNELS) {
            const channels = elementUint(b, audio);
            if (channels < 1 || channels > 2) throw unsupported("webm_channels");
          }
        }
      }
    }
    if (type !== 2) throw unsupported("webm_track_type");
    if (codec !== "A_OPUS") throw unsupported("webm_codec");
    if (number === null || number < 1) throw malformed("webm_track_number");
    state.trackNumber = number;
  }
  if (entries !== 1) throw unsupported("webm_tracks");
}

function readBlock(
  b: Uint8Array,
  start: number,
  end: number,
  clusterTimecode: number | null,
  blockDurationTicks: number,
  state: WebmState
) {
  if (clusterTimecode === null) throw malformed("webm_block_before_timecode");
  // Track number: EBML vint with its length marker removed.
  if (start >= end) throw malformed("webm_block");
  const first = b[start];
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && (first & mask) === 0) {
    length += 1;
    mask >>= 1;
  }
  if (length > 8 || start + length + 3 > end) throw malformed("webm_block");
  let track = first & (mask - 1);
  for (let i = 1; i < length; i += 1) track = track * 256 + b[start + i];
  if (track !== state.trackNumber) throw unsupported("webm_block_track");

  const relative = ((b[start + length] << 24) >> 16) | b[start + length + 1];
  const flags = b[start + length + 2];
  if (flags & 0x06) throw unsupported("webm_lacing");

  const micros = opusPacketMicros(b.subarray(start + length + 3, end));
  if (micros === null) throw malformed("opus_packet");
  state.budget.packet();
  state.micros += micros;
  if (state.micros > state.maxMicros) throw tooLong("decoded");

  const startNanos = (clusterTimecode + relative) * state.timecodeScale;
  if (startNanos < 0) throw malformed("webm_negative_timestamp");
  const endNanos =
    startNanos + Math.max(micros * 1_000, blockDurationTicks * state.timecodeScale);
  if (endNanos > state.maxNanos) throw tooLong("timeline");
  state.timelineNanos = Math.max(state.timelineNanos, endNanos);
}

/** Returns the offset where the Cluster ends (its own end, or the next level-1 element). */
function parseCluster(
  b: Uint8Array,
  cluster: EbmlElement,
  segmentEnd: number,
  state: WebmState
) {
  const end = cluster.unknownSize ? segmentEnd : cluster.dataEnd;
  let timecode: number | null = null;
  let offset = cluster.dataStart;
  while (offset < end) {
    state.budget.element();
    if (cluster.unknownSize && CLOSES_CLUSTER.has(readEbmlId(b, offset, end).id)) {
      return offset;
    }
    const child = readEbmlElement(b, offset, end);
    if (child.unknownSize) throw malformed("webm_unknown_size");
    if (child.id === TIMECODE) {
      if (timecode !== null) throw malformed("webm_timecode");
      timecode = elementUint(b, child);
    } else if (child.id === SIMPLE_BLOCK) {
      readBlock(b, child.dataStart, child.dataEnd, timecode, 0, state);
    } else if (child.id === BLOCK_GROUP) {
      let block: EbmlElement | null = null;
      let durationTicks = 0;
      for (const field of ebmlChildren(b, child, state.budget)) {
        if (field.id === BLOCK) {
          if (block) throw malformed("webm_block_group");
          block = field;
        } else if (field.id === BLOCK_DURATION) {
          durationTicks = elementUint(b, field);
        } else if (!BLOCK_GROUP_SKIPPED_CHILDREN.has(field.id)) {
          throw unsupported("webm_block_group_child");
        }
      }
      if (!block) throw malformed("webm_block_group");
      readBlock(b, block.dataStart, block.dataEnd, timecode, durationTicks, state);
    } else if (!CLUSTER_SKIPPED_CHILDREN.has(child.id)) {
      throw unsupported("webm_cluster_child");
    }
    offset = child.dataEnd;
  }
  return end;
}

function measureWebm(b: Uint8Array, maxSeconds: number): AudioDuration {
  const budget = new Budget(maxSeconds);
  const header = readEbmlElement(b, 0, b.length);
  if (header.id !== EBML || header.unknownSize) throw unsupported("webm_header");
  parseEbmlHeader(b, header, budget);

  const segment = readEbmlElement(b, header.dataEnd, b.length);
  if (segment.id !== SEGMENT) throw unsupported("webm_segment");
  if (segment.dataEnd !== b.length) throw malformed("trailing_bytes");

  const state: WebmState = {
    budget,
    maxMicros: maxSeconds * 1_000_000,
    maxNanos: maxSeconds * 1_000_000_000,
    timecodeScale: 1_000_000,
    infoSeen: false,
    trackNumber: null,
    micros: 0,
    timelineNanos: 0,
  };

  let offset = segment.dataStart;
  while (offset < segment.dataEnd) {
    budget.element();
    const child = readEbmlElement(b, offset, segment.dataEnd);
    if (child.id === CLUSTER) {
      if (!state.infoSeen || state.trackNumber === null) {
        throw malformed("webm_cluster_before_tracks");
      }
      offset = parseCluster(b, child, segment.dataEnd, state);
      continue;
    }
    if (child.unknownSize) throw malformed("webm_unknown_size");
    if (child.id === INFO) {
      if (state.infoSeen) throw malformed("webm_info");
      state.infoSeen = true;
      for (const field of ebmlChildren(b, child, budget)) {
        if (field.id === TIMECODE_SCALE) {
          const scale = elementUint(b, field);
          if (scale < 1 || scale > 1_000_000_000) throw unsupported("webm_timecode_scale");
          state.timecodeScale = scale;
        }
      }
    } else if (child.id === TRACKS) {
      if (state.trackNumber !== null) throw malformed("webm_tracks");
      parseTracks(b, child, state);
    } else if (child.id !== SEEK_HEAD && child.id !== CUES && child.id !== TAGS && child.id !== VOID) {
      throw unsupported("webm_segment_child");
    }
    offset = child.dataEnd;
  }

  if (budget.packets === 0) throw malformed("no_packets");
  return {
    ok: true,
    container: "webm",
    codec: "opus",
    packets: budget.packets,
    seconds: state.micros / 1_000_000,
    timelineSeconds: state.timelineNanos / 1_000_000_000,
  };
}

// ---------------------------------------------------------------------------
// MP4 (ISO BMFF, fragmented, one AAC-LC track)

type Mp4Box = { type: string; start: number; dataStart: number; end: number; toEnd: boolean };

function readBox(b: Uint8Array, offset: number, limit: number): Mp4Box {
  if (limit - offset < 8) throw malformed("mp4_box");
  let size = readUint(b, offset, 4, limit);
  const type = ascii(b, offset + 4, offset + 8);
  let header = 8;
  let toEnd = false;
  if (size === 1) {
    size = readUint(b, offset + 8, 8, limit);
    header = 16;
  } else if (size === 0) {
    size = limit - offset;
    toEnd = true;
  }
  if (size < header || size > limit - offset) throw malformed("mp4_box_size");
  return { type, start: offset, dataStart: offset + header, end: offset + size, toEnd };
}

function* mp4Children(b: Uint8Array, parent: Mp4Box, budget: Budget, skip = 0) {
  let offset = parent.dataStart + skip;
  while (offset < parent.end) {
    budget.element();
    const child = readBox(b, offset, parent.end);
    if (child.toEnd) throw malformed("mp4_box_size");
    yield child;
    offset = child.end;
  }
}

/** Version and flags of a full box. */
function fullBox(b: Uint8Array, box: Mp4Box) {
  const word = readUint(b, box.dataStart, 4, box.end);
  return { version: Math.floor(word / 0x1000000), flags: word % 0x1000000 };
}

const AAC_SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
const ALLOWED_AAC_SAMPLE_RATES = new Set([8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]);

type AacTrack = { trackId: number; timescale: number; sampleRate: number; frameLength: number };

function readDescriptor(b: Uint8Array, offset: number, limit: number) {
  const tag = readUint(b, offset, 1, limit);
  let length = 0;
  let cursor = offset + 1;
  for (let i = 0; i < 4; i += 1) {
    const byte = readUint(b, cursor, 1, limit);
    cursor += 1;
    length = length * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) break;
    if (i === 3) throw malformed("mp4_descriptor");
  }
  if (length > limit - cursor) throw malformed("mp4_descriptor");
  return { tag, start: cursor, end: cursor + length };
}

/** AudioSpecificConfig (ISO 14496-3): AAC-LC only, mono or stereo. */
function parseAudioSpecificConfig(b: Uint8Array, start: number, end: number) {
  let bit = 0;
  const totalBits = (end - start) * 8;
  const read = (count: number) => {
    if (bit + count > totalBits) throw malformed("mp4_asc");
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      const byte = b[start + ((bit + i) >> 3)];
      value = value * 2 + ((byte >> (7 - ((bit + i) & 7))) & 1);
    }
    bit += count;
    return value;
  };
  if (read(5) !== 2) throw unsupported("aac_profile");
  const rateIndex = read(4);
  const sampleRate = rateIndex === 15 ? read(24) : AAC_SAMPLE_RATES[rateIndex];
  if (!ALLOWED_AAC_SAMPLE_RATES.has(sampleRate)) throw unsupported("aac_sample_rate");
  const channels = read(4);
  if (channels < 1 || channels > 2) throw unsupported("aac_channels");
  const frameLength = read(1) ? 960 : 1024;
  if (read(1) !== 0) throw unsupported("aac_core_coder");
  if (read(1) !== 0) throw unsupported("aac_extension");
  // Backward-compatible SBR/PS signalling (HE-AAC) follows as 0x2b7.
  if (totalBits - bit >= 16 && read(11) === 0x2b7) throw unsupported("aac_sbr");
  return { sampleRate, frameLength };
}

function parseEsds(b: Uint8Array, esds: Mp4Box) {
  if (fullBox(b, esds).version !== 0) throw unsupported("mp4_esds");
  const es = readDescriptor(b, esds.dataStart + 4, esds.end);
  if (es.tag !== 0x03) throw malformed("mp4_esds");
  const esFlags = readUint(b, es.start + 2, 1, es.end);
  let cursor = es.start + 3;
  if (esFlags & 0x80) cursor += 2;
  if (esFlags & 0x40) cursor += 1 + readUint(b, cursor, 1, es.end);
  if (esFlags & 0x20) cursor += 2;
  const config = readDescriptor(b, cursor, es.end);
  if (config.tag !== 0x04) throw malformed("mp4_esds");
  if (readUint(b, config.start, 1, config.end) !== 0x40) throw unsupported("mp4_object_type");
  if (readUint(b, config.start + 1, 1, config.end) >> 2 !== 0x05) throw unsupported("mp4_stream_type");
  const specific = readDescriptor(b, config.start + 13, config.end);
  if (specific.tag !== 0x05) throw malformed("mp4_esds");
  return parseAudioSpecificConfig(b, specific.start, specific.end);
}

function parseSampleEntry(b: Uint8Array, stsd: Mp4Box, budget: Budget) {
  if (readUint(b, stsd.dataStart + 4, 4, stsd.end) !== 1) throw unsupported("mp4_stsd");
  const entries = [...mp4Children(b, stsd, budget, 8)];
  if (entries.length !== 1) throw unsupported("mp4_stsd");
  const entry = entries[0];
  if (entry.type !== "mp4a") throw unsupported(`mp4_codec_${entry.type.trim() || "?"}`);
  // AudioSampleEntry v0: reserved(6) data_reference_index(2) version(2)
  // revision(2) vendor(4) channelcount(2) samplesize(2) pre_defined(2)
  // reserved(2) samplerate(4), then child boxes.
  if (readUint(b, entry.dataStart + 8, 2, entry.end) !== 0) throw unsupported("mp4_sound_version");
  const channels = readUint(b, entry.dataStart + 16, 2, entry.end);
  if (channels < 1 || channels > 2) throw unsupported("mp4_channels");
  let config: { sampleRate: number; frameLength: number } | null = null;
  for (const child of mp4Children(b, entry, budget, 28)) {
    if (child.type === "esds") {
      if (config) throw malformed("mp4_esds");
      config = parseEsds(b, child);
    } else if (child.type !== "btrt") {
      throw unsupported("mp4_sample_entry_child");
    }
  }
  if (!config) throw malformed("mp4_esds");
  return config;
}

function parseStbl(b: Uint8Array, stbl: Mp4Box, budget: Budget) {
  let config: { sampleRate: number; frameLength: number } | null = null;
  for (const box of mp4Children(b, stbl, budget)) {
    if (box.type === "stsd") {
      if (config) throw malformed("mp4_stsd");
      config = parseSampleEntry(b, box, budget);
    } else if (box.type === "stts" || box.type === "stsc" || box.type === "stco" || box.type === "co64") {
      // Fragmented files keep their samples in moof/trun, not here.
      if (readUint(b, box.dataStart + 4, 4, box.end) !== 0) throw unsupported("mp4_non_fragmented");
    } else if (box.type === "stsz") {
      if (readUint(b, box.dataStart + 8, 4, box.end) !== 0) throw unsupported("mp4_non_fragmented");
    } else if (box.type !== "sgpd" && box.type !== "sbgp" && box.type !== "free") {
      throw unsupported("mp4_stbl_child");
    }
  }
  if (!config) throw malformed("mp4_stsd");
  return config;
}

function parseElst(b: Uint8Array, elst: Mp4Box) {
  const { version } = fullBox(b, elst);
  if (version > 1) throw unsupported("mp4_elst");
  const count = readUint(b, elst.dataStart + 4, 4, elst.end);
  const entrySize = version === 1 ? 20 : 12;
  if (count > 1) throw unsupported("mp4_edits");
  if (elst.end - elst.dataStart !== 8 + count * entrySize) throw malformed("mp4_elst");
  if (count === 1) {
    const entry = elst.dataStart + 8;
    const timeOffset = entry + (version === 1 ? 8 : 4);
    const timeBytes = version === 1 ? 8 : 4;
    // An empty edit (media_time -1) inserts silence: reject any negative time.
    if (b[timeOffset] & 0x80) throw unsupported("mp4_empty_edit");
    readUint(b, timeOffset, timeBytes, elst.end);
    if (readUint(b, timeOffset + timeBytes, 4, elst.end) !== 0x00010000) {
      throw unsupported("mp4_edit_rate");
    }
  }
}

function parseMoov(b: Uint8Array, moov: Mp4Box, budget: Budget) {
  let track: AacTrack | null = null;
  let tracks = 0;
  let trexTrackId: number | null = null;
  let defaults = { duration: 0, size: 0 };
  let mvhd = false;
  for (const box of mp4Children(b, moov, budget)) {
    if (box.type === "mvhd") {
      mvhd = true;
    } else if (box.type === "trak") {
      tracks += 1;
      if (tracks > 1) throw unsupported("mp4_tracks");
      let trackId: number | null = null;
      let media: { timescale: number; sampleRate: number; frameLength: number } | null = null;
      for (const child of mp4Children(b, box, budget)) {
        if (child.type === "tkhd") {
          const { version } = fullBox(b, child);
          trackId = readUint(b, child.dataStart + (version === 1 ? 20 : 12), 4, child.end);
        } else if (child.type === "edts") {
          for (const edit of mp4Children(b, child, budget)) {
            if (edit.type !== "elst") throw unsupported("mp4_edts_child");
            parseElst(b, edit);
          }
        } else if (child.type === "mdia") {
          let timescale = 0;
          let sound = false;
          let config: { sampleRate: number; frameLength: number } | null = null;
          for (const part of mp4Children(b, child, budget)) {
            if (part.type === "mdhd") {
              const { version } = fullBox(b, part);
              timescale = readUint(b, part.dataStart + (version === 1 ? 20 : 12), 4, part.end);
            } else if (part.type === "hdlr") {
              sound = ascii(b, part.dataStart + 8, Math.min(part.dataStart + 12, part.end)) === "soun";
            } else if (part.type === "minf") {
              for (const info of mp4Children(b, part, budget)) {
                if (info.type === "stbl") {
                  if (config) throw malformed("mp4_stbl");
                  config = parseStbl(b, info, budget);
                } else if (info.type !== "smhd" && info.type !== "dinf" && info.type !== "free") {
                  throw unsupported("mp4_minf_child");
                }
              }
            } else if (part.type !== "elng" && part.type !== "udta" && part.type !== "free") {
              throw unsupported("mp4_mdia_child");
            }
          }
          if (!sound) throw unsupported("mp4_handler");
          if (timescale < 1) throw malformed("mp4_timescale");
          if (!config) throw malformed("mp4_stbl");
          media = { timescale, ...config };
        } else if (child.type !== "udta" && child.type !== "meta" && child.type !== "free") {
          throw unsupported("mp4_trak_child");
        }
      }
      if (trackId === null || !media) throw malformed("mp4_trak");
      track = { trackId, ...media };
    } else if (box.type === "mvex") {
      for (const child of mp4Children(b, box, budget)) {
        if (child.type === "trex") {
          if (trexTrackId !== null) throw unsupported("mp4_trex");
          trexTrackId = readUint(b, child.dataStart + 4, 4, child.end);
          defaults = {
            duration: readUint(b, child.dataStart + 12, 4, child.end),
            size: readUint(b, child.dataStart + 16, 4, child.end),
          };
        } else if (child.type !== "mehd" && child.type !== "free") {
          throw unsupported("mp4_mvex_child");
        }
      }
    } else if (!["udta", "meta", "iods", "free", "skip"].includes(box.type)) {
      throw unsupported("mp4_moov_child");
    }
  }
  if (!mvhd || !track) throw malformed("mp4_moov");
  if (trexTrackId === null) throw unsupported("mp4_non_fragmented");
  if (trexTrackId !== track.trackId) throw malformed("mp4_trex_track");
  return { track, defaults };
}

type Mp4State = {
  budget: Budget;
  maxSeconds: number;
  track: AacTrack;
  defaults: { duration: number; size: number };
  samples: number;
  /** End of the previous fragment on the media timeline, in timescale units. */
  fragmentEnd: number;
  timelineUnits: number;
};

const TFHD_KNOWN_FLAGS = 0x000002 | 0x000008 | 0x000010 | 0x000020 | 0x020000;
const TRUN_KNOWN_FLAGS = 0x000001 | 0x000004 | 0x000100 | 0x000200 | 0x000400;

function parseMoof(b: Uint8Array, moof: Mp4Box, mdat: Mp4Box, state: Mp4State) {
  let trafs = 0;
  for (const box of mp4Children(b, moof, state.budget)) {
    if (box.type === "mfhd") continue;
    if (box.type !== "traf") throw unsupported("mp4_moof_child");
    trafs += 1;
    if (trafs > 1) throw unsupported("mp4_trafs");

    let duration = state.defaults.duration;
    let size = state.defaults.size;
    let tfhd = false;
    let time: number | null = null;
    // Sample data must fill this fragment's mdat exactly, in order.
    let expectedOffset = mdat.dataStart;
    let truns = 0;
    for (const child of mp4Children(b, box, state.budget)) {
      if (child.type === "tfhd") {
        if (tfhd) throw malformed("mp4_tfhd");
        tfhd = true;
        const { flags } = fullBox(b, child);
        if (flags & ~TFHD_KNOWN_FLAGS) throw unsupported("mp4_tfhd_flags");
        if (readUint(b, child.dataStart + 4, 4, child.end) !== state.track.trackId) {
          throw malformed("mp4_tfhd_track");
        }
        let cursor = child.dataStart + 8;
        if (flags & 0x000002) {
          if (readUint(b, cursor, 4, child.end) !== 1) throw unsupported("mp4_sample_description");
          cursor += 4;
        }
        if (flags & 0x000008) {
          duration = readUint(b, cursor, 4, child.end);
          cursor += 4;
        }
        if (flags & 0x000010) {
          size = readUint(b, cursor, 4, child.end);
          cursor += 4;
        }
        if (flags & 0x000020) cursor += 4;
        if (cursor !== child.end) throw malformed("mp4_tfhd");
      } else if (child.type === "tfdt") {
        if (!tfhd || time !== null || truns > 0) throw malformed("mp4_tfdt");
        const { version } = fullBox(b, child);
        const bytes = version === 1 ? 8 : 4;
        if (child.end - child.dataStart !== 4 + bytes) throw malformed("mp4_tfdt");
        time = readUint(b, child.dataStart + 4, bytes, child.end);
      } else if (child.type === "trun") {
        if (!tfhd) throw malformed("mp4_trun");
        truns += 1;
        const { flags } = fullBox(b, child);
        if (flags & ~TRUN_KNOWN_FLAGS) throw unsupported("mp4_trun_flags");
        const count = readUint(b, child.dataStart + 4, 4, child.end);
        let cursor = child.dataStart + 8;
        // Without data_offset the first run starts at the base (the moof),
        // later runs right after the previous one (ISO 14496-12, 8.8.8).
        let dataOffset = truns === 1 ? moof.start : expectedOffset;
        if (flags & 0x000001) {
          const raw = readUint(b, cursor, 4, child.end);
          dataOffset = moof.start + (raw >= 0x80000000 ? raw - 0x100000000 : raw);
          cursor += 4;
        }
        if (flags & 0x000004) cursor += 4;
        const perSample =
          (flags & 0x000100 ? 4 : 0) + (flags & 0x000200 ? 4 : 0) + (flags & 0x000400 ? 4 : 0);
        // The declared count must match the box size before it is trusted.
        if (child.end - cursor !== count * perSample) throw malformed("mp4_trun_size");
        if (dataOffset !== expectedOffset) throw malformed("mp4_data_offset");
        if (time === null) time = state.fragmentEnd;

        state.budget.packet(count);
        state.samples += count;
        if (state.samples * state.track.frameLength > state.maxSeconds * state.track.sampleRate) {
          throw tooLong("decoded");
        }
        for (let i = 0; i < count; i += 1) {
          let sampleDuration = duration;
          let sampleSize = size;
          if (flags & 0x000100) {
            sampleDuration = readUint(b, cursor, 4, child.end);
            cursor += 4;
          }
          if (flags & 0x000200) {
            sampleSize = readUint(b, cursor, 4, child.end);
            cursor += 4;
          }
          if (flags & 0x000400) cursor += 4;
          if (sampleSize < 1) throw malformed("mp4_sample_size");
          expectedOffset += sampleSize;
          if (expectedOffset > mdat.end) throw malformed("mp4_sample_outside_mdat");
          time += sampleDuration;
        }
        if (time > state.maxSeconds * state.track.timescale) throw tooLong("timeline");
        state.timelineUnits = Math.max(state.timelineUnits, time);
      } else if (child.type !== "sgpd" && child.type !== "sbgp" && child.type !== "free") {
        throw unsupported("mp4_traf_child");
      }
    }
    if (!tfhd || truns === 0) throw malformed("mp4_traf");
    if (expectedOffset !== mdat.end) throw malformed("mp4_mdat_unaccounted");
    state.fragmentEnd = time ?? state.fragmentEnd;
  }
  if (trafs !== 1) throw malformed("mp4_moof");
}

function measureMp4(b: Uint8Array, maxSeconds: number): AudioDuration {
  const budget = new Budget(maxSeconds);
  const ftyp = readBox(b, 0, b.length);
  if (ftyp.type !== "ftyp" || ftyp.end - ftyp.dataStart < 8) throw unsupported("mp4_ftyp");

  let state: Mp4State | null = null;
  let offset = ftyp.end;
  while (offset < b.length) {
    budget.element();
    const box = readBox(b, offset, b.length);
    if (box.toEnd && box.type !== "mdat") throw malformed("mp4_box_size");
    if (box.type === "moov") {
      if (state) throw malformed("mp4_moov");
      const { track, defaults } = parseMoov(b, box, budget);
      state = { budget, maxSeconds, track, defaults, samples: 0, fragmentEnd: 0, timelineUnits: 0 };
    } else if (box.type === "moof") {
      if (!state) throw malformed("mp4_moof_before_moov");
      if (box.end >= b.length) throw malformed("mp4_moof_without_mdat");
      const mdat = readBox(b, box.end, b.length);
      if (mdat.type !== "mdat") throw malformed("mp4_moof_without_mdat");
      parseMoof(b, box, mdat, state);
      offset = mdat.end;
      continue;
    } else if (box.type === "mdat") {
      throw malformed("mp4_mdat_without_moof");
    } else if (!["free", "skip", "sidx", "mfra"].includes(box.type)) {
      throw unsupported("mp4_top_level");
    }
    offset = box.end;
  }

  if (!state) throw malformed("mp4_moov");
  if (state.samples === 0) throw malformed("no_packets");
  return {
    ok: true,
    container: "mp4",
    codec: "aac",
    packets: state.samples,
    seconds: (state.samples * state.track.frameLength) / state.track.sampleRate,
    timelineSeconds: state.timelineUnits / state.track.timescale,
  };
}

// ---------------------------------------------------------------------------

/**
 * Measures the clip and rejects it when it is not one of the supported
 * formats, is malformed, or is longer than maxSeconds (decoded or on the
 * container timeline). Never throws.
 */
export function measureAudioDuration(
  bytes: Uint8Array,
  options: { maxSeconds: number }
): AudioDuration {
  const maxSeconds = options.maxSeconds;
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0) {
    return { ok: false, reason: "too_long", detail: "invalid_limit" };
  }
  try {
    if (bytes.length >= 4 && readUint(bytes, 0, 4, bytes.length) === EBML) {
      return measureWebm(bytes, maxSeconds);
    }
    if (bytes.length >= 8 && ascii(bytes, 4, 8) === "ftyp") {
      return measureMp4(bytes, maxSeconds);
    }
    return { ok: false, reason: "unsupported", detail: "container" };
  } catch (error) {
    if (error instanceof AudioRejection) {
      return { ok: false, reason: error.reason, detail: error.detail };
    }
    return { ok: false, reason: "malformed", detail: "parse_error" };
  }
}
