# Grabaciones reales de `MediaRecorder` (sin voz)

Muestras para `audio-duration.test.ts`. Son 3 s de un tono de 440 Hz generado con WebAudio, sin micrófono, así que no contienen voz ni datos personales.

Se grabaron el 19/10/2026 con Playwright 1.58.2 y `scripts/record-audio-fixtures.mjs`, pidiendo 48 kbps, como la grabadora de la app. El número de paquetes se contrastó con Mediabunny 1.61.3, una implementación independiente que se usó solo fuera de línea y no es dependencia del proyecto.

| Fichero | Navegador | Contenedor / códec | Paquetes | Duración medida | Cabecera del contenedor |
| --- | --- | --- | --- | --- | --- |
| `chromium-145-3s.webm` | Chromium 145 | WebM / Opus, paquetes de 60 ms | 48 | 2,880 s | `Duration` 2.820 ms |
| `firefox-146-3s.webm` | Firefox 146 | WebM / Opus, Segment y Cluster de tamaño desconocido, paquetes de 20 ms | 151 | 3,020 s | `Duration` 0 |
| `webkit-26-3s.webm` | WebKit 26 (Safari) | WebM / Opus, tamaño desconocido, paquetes de 2,5 ms | 1.150 | 2,875 s | sin `Duration` |
| `webkit-26-3s-aac.mp4` | WebKit 26 (Safari) | MP4 fragmentado / AAC-LC, 44,1 kHz, estéreo | 125 | 2,902 s | `mvhd`/`mdhd` 0 |
| `chromium-145-3s-opus.mp4` | Chromium 145 | MP4 / Opus | — | se rechaza | la app no lo genera |
| `firefox-146-3s.ogg` | Firefox 146 | Ogg / Opus | — | se rechaza | la app no lo genera |

Las tres muestras WebM son lo que elige `pickMimeType` en cada navegador. Safari en iOS 18.4 o posterior también graba WebM/Opus. Las versiones anteriores graban MP4/AAC.

## Validación con grabaciones largas (fuera del repositorio)

Con el mismo script, a 59 s y a 62 s, y un límite de 61 s (60 + 1):

| Grabación | Bytes | Resultado |
| --- | --- | --- |
| Chromium WebM, 59 s | 358.642 | aceptada, 58,74 s |
| Chromium WebM, 62 s | 378.438 | `too_long` (decoded) |
| Firefox WebM, 59 s | 385.504 | aceptada, 59,10 s |
| Firefox WebM, 62 s | 404.416 | `too_long` (timeline) |
| WebKit WebM, 59 s | 557.104 | aceptada, 59,00 s (23.600 paquetes) |
| WebKit WebM, 62 s | 585.298 | `too_long` (decoded) |
| WebKit MP4/AAC, 59 s | 1.091.808 | aceptada, 59,05 s |
| WebKit MP4/AAC, 62 s | 1.149.792 | `too_long` (decoded) |

WebKit graba el AAC a unos 146 kbps aunque se le pidan 48. Por eso el tope de bytes usa 256 kbps (`MAX_AUDIO_BITS_PER_SECOND`).

## Pendiente (G5)

Faltan muestras de dispositivos reales: iPhone con Safari 18.4 o posterior (WebM), iPhone con iOS anterior a 18.4 (MP4/AAC) y Android con Chrome. Se graban con la misma página, con el tono, y se añaden aquí con sus valores esperados.
