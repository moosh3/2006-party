/** Public playback metadata verified against the team's after-party Mux
 * environment. No credentials, signed URLs, or invented cue offsets. */
export const SHOW_MEDIA = [
  { key: 'corn-castle', title: 'Corn Castle_Captioned', assetId: 'roPTO2hJo028EhUup1fha5CWNjgRxZX00Wz6L19o02cNxU', playbackId: 'wIXfSl02x001vz00rFdBXuiGTthtD9tvM6RXA9ZNbitUzk', durationSeconds: 454.8637 },
  { key: 'gorillaz', title: 'Gorillaz 2006 (Captioned)', assetId: 'glvwBBDR1Z2KWw3U7vMpnNY00V5KCdNI8lr02QJl0100u5Q', playbackId: 'Fl4jlqwiHy45XeeYeh1lXBPODSQRlywNSHn9gn012PRQ', durationSeconds: 342.033333 },
  { key: 'when-you-were-young', title: 'When You Were Young', assetId: '02MlQm8rmc01qAVbhE011tDekH38H502w8Aurw9WxOt01DX00', playbackId: 'nbi8AhGKn9PNvGOye6bQU2GIe1XAJqtb7GOzyvklG00s', durationSeconds: 233 },
  { key: 'xanga', title: 'xanga 2006 v 2', assetId: 'TI5evbLNCADc0147YygACTgOYbHcOM1sW1rfgvwQYTgs', playbackId: 'c8MLFhg48G028QB9ERFacouY88L2100PIQXhvgS1eiCNM', durationSeconds: 146.583333 },
  { key: 'clippy', title: 'Clippy All Clips_Captioned', assetId: 'J02ilb9Gz1ve1EPmhs8j9HFOmZJ1UNo00YfBOYgeoLpvs', playbackId: 'OXufZP7pl1PPVXUUYN1vWW02ZyXWzAmLW6WwN8fzElfc', durationSeconds: 152.666667 },
] as const;

export type ShowMediaKey = typeof SHOW_MEDIA[number]['key'];
