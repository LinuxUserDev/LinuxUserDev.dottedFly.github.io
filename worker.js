// DottedFly worker.js
// Calls YouTube's internal /youtubei/v1/player API directly (same API the YouTube app uses).
// Returns a direct audio stream URL. No third-party services involved.

const YT_API_URL = 'https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8&prettyPrint=false';

// Android client context — returns direct, non-encrypted stream URLs
const YT_CLIENT = {
  clientName: 'ANDROID',
  clientVersion: '19.09.37',
  androidSdkVersion: 30,
  userAgent: 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
  hl: 'en',
  gl: 'US',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    // Pass all non-proxy requests to static assets
    if (url.pathname !== '/proxy') {
      return env.ASSETS.fetch(request);
    }

    const videoId = url.searchParams.get('id');
    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return jsonResponse({ error: 'Missing or invalid video id' }, 400);
    }

    try {
      const body = {
        videoId,
        context: { client: YT_CLIENT },
        contentCheckOk: true,
        racyCheckOk: true,
      };

      const res = await fetch(YT_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': YT_CLIENT.userAgent,
          'X-YouTube-Client-Name': '3',
          'X-YouTube-Client-Version': YT_CLIENT.clientVersion,
          'Origin': 'https://www.youtube.com',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        return jsonResponse({ error: `YouTube API returned ${res.status}` }, 502);
      }

      const data = await res.json();

      const status = data?.playabilityStatus?.status;
      if (status && status !== 'OK') {
        const reason = data?.playabilityStatus?.reason || status;
        return jsonResponse({ error: `Video not playable: ${reason}` }, 403);
      }

      const formats = data?.streamingData?.adaptiveFormats || [];

      // Audio-only streams, highest bitrate first
      const audioFormats = formats
        .filter(f => f.mimeType && f.mimeType.startsWith('audio/') && f.url)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

      if (audioFormats.length === 0) {
        // Fallback to combined video+audio formats
        const combined = (data?.streamingData?.formats || [])
          .filter(f => f.url)
          .sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));
        if (combined.length > 0) {
          const f = combined[0];
          return jsonResponse({ url: f.url, quality: f.qualityLabel || 'combined', codec: f.mimeType });
        }
        return jsonResponse({ error: 'No playable audio streams found' }, 502);
      }

      const best = audioFormats[0];
      return jsonResponse({
        url: best.url,
        quality: best.audioQuality || 'unknown',
        codec: best.mimeType,
        bitrate: best.bitrate,
      });

    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  },
};
