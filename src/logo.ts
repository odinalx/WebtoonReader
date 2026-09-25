// Dokhae's mark: the head of Dok, the mascot (a baby dokkaebi), with the bold
// lines of the site's favicon so it reads at toolbar size. The same drawing
// as public/icon/logo.svg; inlined here for the in-page panel, whose closed
// shadow root cannot load extension files unless they are web-accessible.
export const LOGO_VIEWBOX = '-14 -60 628 628';

export const LOGO_SVG_BODY =
  '<g stroke="#14141a" stroke-width="24" stroke-linejoin="round" stroke-linecap="round"><path fill="#fbf8f1" d="M132 214 C 80 218 18 240 10 272 C 4 300 34 324 80 330 C 100 332 116 330 124 326 Z"/><path fill="#fbf8f1" d="M468 214 C 520 218 582 240 590 272 C 596 300 566 324 520 330 C 500 332 484 330 476 326 Z"/><path fill="#fbf8f1" d="M300 116 C 430 116 510 206 526 318 C 542 434 474 490 300 490 C 126 490 58 434 74 318 C 90 206 170 116 300 116 Z"/><path fill="#2f4bd8" d="M287 20 C 294 5 306 5 313 20 L 368 132 C 376 152 344 164 300 164 C 256 164 224 152 232 132 Z"/><path fill="none" stroke-width="16" d="M250 92 C 280 106 320 106 350 90"/><path fill="none" stroke-width="30" d="M176 246 C 198 252 222 262 240 276"/><path fill="none" stroke-width="30" d="M424 246 C 402 252 378 262 360 276"/><path fill="none" stroke-width="20" d="M248 362 C 256 382 278 384 290 368 C 300 356 312 358 320 370 C 332 386 350 380 356 362"/> /></g><ellipse cx="206" cy="306" rx="42" ry="45" fill="#14141a"/><ellipse cx="394" cy="306" rx="42" ry="45" fill="#14141a"/><circle cx="221" cy="291" r="11.5" fill="#fff"/><circle cx="379" cy="291" r="11.5" fill="#fff"/><ellipse cx="150" cy="354" rx="38" ry="29" fill="#fdbab3"/><ellipse cx="450" cy="354" rx="38" ry="29" fill="#fdbab3"/>';

export const logoSvg = (size: number, className = '') =>
  `<svg class="${className}" viewBox="${LOGO_VIEWBOX}" width="${size}" height="${size}" aria-hidden="true">${LOGO_SVG_BODY}</svg>`;
