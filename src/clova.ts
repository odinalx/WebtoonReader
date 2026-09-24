import type { Settings } from './types';

// Naver Clova Voice. Called from the background service worker. Parked: its
// settings are hidden and the manifest no longer asks for *.apigw.ntruss.com,
// so to bring it back, add that host permission again with the UI.

// ---------------------------------------------------------------------------
// Clova Voice — Korean text → spoken audio (mp3 data URL)
// ---------------------------------------------------------------------------

export async function clovaTts(text: string, settings: Settings): Promise<string> {
  const res = await fetch(
    'https://naveropenapi.apigw.ntruss.com/tts-premium/v1/tts',
    {
      method: 'POST',
      headers: {
        'X-NCP-APIGW-API-KEY-ID': settings.voiceApiKeyId,
        'X-NCP-APIGW-API-KEY': settings.voiceApiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        speaker: settings.voiceSpeaker || 'nara',
        text: text.slice(0, 1000),
        format: 'mp3',
        speed: '0',
        volume: '0',
        pitch: '0',
      }).toString(),
    }
  );

  if (!res.ok) {
    throw new Error(`Clova Voice HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  const chunk = 8192;
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode(...buf.subarray(i, Math.min(i + chunk, buf.length)));
  }
  return 'data:audio/mp3;base64,' + btoa(bin);
}
