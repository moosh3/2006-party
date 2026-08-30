'use client';

import { useEffect, useState } from 'react';
import { LL } from '@/components/lobby-lounge/tokens';

interface VideoPlaylistItem {
  videoId: string;
  title: string;
  thumbnailUrl: string | null;
  position: number;
}

interface VideoPlaylistResponse {
  enabled: boolean;
  title: string;
  sourceUrl: string | null;
  playlistId: string | null;
  items: VideoPlaylistItem[];
}

function getVideoUrl(playlistId: string, videoId: string) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&list=${encodeURIComponent(playlistId)}`;
}

function getPlaylistUrl(playlistId: string) {
  return `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
}

export default function VideoPlaylistShelf({ emptyMessage }: { emptyMessage?: string } = {}) {
  const [playlist, setPlaylist] = useState<VideoPlaylistResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPlaylist() {
      try {
        const response = await fetch('/api/video-playlist');
        if (!response.ok) return;

        const data = await response.json();
        if (!cancelled) {
          setPlaylist(data);
        }
      } catch (error) {
        console.error('Failed to load video playlist:', error);
      }
    }

    loadPlaylist();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!playlist?.enabled || !playlist.playlistId) {
    return emptyMessage ? <p className="xp2006-queue-empty">{playlist ? emptyMessage : 'Checking the video queue…'}</p> : null;
  }

  return (
    <section className="ll-video-playlist" aria-label={playlist.title}>
      <style>{`
        .ll-video-playlist { display: grid; gap: 6px; min-width: 0; }
        .ll-video-playlist-head { display: flex; align-items: baseline; justify-content: center; gap: 8px; }
        .ll-video-playlist-track {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          overscroll-behavior-inline: contain;
          scroll-snap-type: x proximity;
          padding: 2px 2px 8px;
          scrollbar-color: ${LL.lime} rgba(255,255,255,.12);
        }
        .ll-video-playlist-card {
          width: 132px;
          flex: 0 0 132px;
          color: ${LL.frost1};
          text-decoration: none;
          scroll-snap-align: start;
        }
        .ll-video-playlist-thumb {
          aspect-ratio: 16 / 9;
          border: 2px solid ${LL.ink};
          border-radius: 6px;
          overflow: hidden;
          background: ${LL.deep};
          box-shadow: 3px 3px 0 rgba(0,0,0,.45);
          position: relative;
        }
        .ll-video-playlist-card:focus-visible .ll-video-playlist-thumb,
        .ll-video-playlist-card:hover .ll-video-playlist-thumb {
          outline: 2px solid ${LL.lime};
          outline-offset: 2px;
        }
        .ll-video-playlist-thumb-img {
          width: 100%;
          height: 100%;
          background-size: cover;
          background-position: center;
        }
        .ll-video-playlist-title {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          min-height: 28px;
          margin-top: 5px;
          color: ${LL.frost2};
          font-size: 11px;
          line-height: 1.25;
        }
        .ll-video-playlist-playall {
          display: grid;
          place-items: center;
          height: 100%;
          background: linear-gradient(180deg, ${LL.frost1} 0%, ${LL.mint} 62%, #7eb9a0 100%);
          color: ${LL.ink};
          text-align: center;
          padding: 8px;
        }
        .ll-video-playlist-playicon {
          width: 34px;
          height: 34px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          background: ${LL.ink};
          color: ${LL.lime};
          margin-bottom: 5px;
          box-shadow: 2px 2px 0 rgba(0,0,0,.25);
        }
        @media (max-width: 900px) {
          .ll-video-playlist-card { width: 124px; flex-basis: 124px; }
        }
      `}</style>

      <div className="ll-video-playlist-head">
        <h3 className="f-display" style={{ textAlign: 'center', color: LL.lime, fontSize: 12 }}>
          {playlist.title.toUpperCase()}
        </h3>
        <span className="f-comic" style={{ color: LL.frost2, fontSize: 11 }}>
          {playlist.items.length} videos
        </span>
      </div>

      <div className="ll-video-playlist-track">
        <a
          className="ll-video-playlist-card"
          href={getPlaylistUrl(playlist.playlistId)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <div className="ll-video-playlist-thumb">
            <div className="ll-video-playlist-playall">
              <div className="ll-video-playlist-playicon f-display">▶</div>
              <div className="f-display" style={{ fontSize: 13 }}>PLAY ALL</div>
            </div>
          </div>
          <div className="ll-video-playlist-title f-comic">Open the full playlist</div>
        </a>

        {playlist.items.map((item) => (
          <a
            key={item.videoId}
            className="ll-video-playlist-card"
            href={getVideoUrl(playlist.playlistId!, item.videoId)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <div className="ll-video-playlist-thumb">
              {item.thumbnailUrl ? (
                <div
                  className="ll-video-playlist-thumb-img"
                  style={{ backgroundImage: `url(${item.thumbnailUrl})` }}
                />
              ) : (
                <div className="ll-video-playlist-playall f-display" style={{ fontSize: 11 }}>
                  VIDEO
                </div>
              )}
            </div>
            <div className="ll-video-playlist-title f-comic">{item.title}</div>
          </a>
        ))}
      </div>
    </section>
  );
}
