'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import PollCard from './PollCard';
import {
  ROOM_NAMES,
  CHANNEL_NAMES,
  DATABASE_TABLES,
} from '@/lib/constants';

interface PollData {
  id: string;
  question: string;
  is_open: boolean;
  created_at: string;
  closed_at: string | null;
  total_votes: number;
  options: {
    id: string;
    label: string;
    vote_count: number;
    percentage: number;
  }[];
}

interface PollsTabProps {
  userId: string;
  room?: string;
}

export default function PollsTab({ userId, room = ROOM_NAMES.DEFAULT }: PollsTabProps) {
  const [polls, setPolls] = useState<PollData[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'active' | 'closed'>('active');

  const loadPolls = useCallback(async () => {
    try {
      const response = await fetch(`/api/polls?room=${room}&userId=${userId}`);
      if (response.ok) {
        const data = await response.json();
        setPolls(data.polls || []);
      }
    } catch (error) {
      console.error('Failed to load polls:', error);
    } finally {
      setLoading(false);
    }
  }, [room, userId]);

  useEffect(() => {
    loadPolls();

    // Subscribe to poll changes
    const channel = supabase
      .channel(CHANNEL_NAMES.POLLS_TAB)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: DATABASE_TABLES.POLLS,
        },
        () => {
          loadPolls();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: DATABASE_TABLES.POLL_VOTES,
        },
        () => {
          loadPolls();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadPolls]);

  const activePolls = polls.filter(p => p.is_open);
  const closedPolls = polls.filter(p => !p.is_open);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2" style={{ borderColor: '#c9ff2d' }}></div>
      </div>
    );
  }

  if (polls.length === 0) {
    return (
      <div className="text-center p-8">
        <p className="text-sm" style={{ color: '#555' }}>No polls yet. Check back later.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tab Navigation */}
      <div className="flex gap-2" style={{ borderBottom: '2px solid #2a1a55' }}>
        <button
          onClick={() => setActiveTab('active')}
          className="px-4 py-2 font-semibold text-sm transition-colors relative f-comic"
          style={{ color: activeTab === 'active' ? '#0000cc' : '#555' }}
        >
          Active Polls
          {activePolls.length > 0 && (
            <span className="ml-2 px-2 py-0.5 text-xs rounded-full font-bold" style={{ background: '#ff2eb8', color: '#fff' }}>
              {activePolls.length}
            </span>
          )}
          {activeTab === 'active' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: '#316ac5' }}></div>
          )}
        </button>
        <button
          onClick={() => setActiveTab('closed')}
          className="px-4 py-2 font-semibold text-sm transition-colors relative f-comic"
          style={{ color: activeTab === 'closed' ? '#0000cc' : '#555' }}
        >
          Past Results
          {closedPolls.length > 0 && (
            <span className="ml-2 px-2 py-0.5 text-xs rounded-full" style={{ background: '#a18ad4', color: '#1a1230' }}>
              {closedPolls.length}
            </span>
          )}
          {activeTab === 'closed' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: '#316ac5' }}></div>
          )}
        </button>
      </div>

      {/* Tab Content */}
      <div className="space-y-4">
        {activeTab === 'active' && (
          <>
            {activePolls.length === 0 ? (
              <div className="text-center p-8 twitch-card">
                <p className="text-casual-dark/70 text-sm">No active polls right now.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {activePolls.map((poll) => (
                  <PollCard key={poll.id} pollId={poll.id} userId={userId} room={room} />
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === 'closed' && (
          <>
            {closedPolls.length === 0 ? (
              <div className="text-center p-8 twitch-card">
                <p className="text-casual-dark/70 text-sm">No past polls to show.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {closedPolls.map((poll) => (
                  <PollCard key={poll.id} pollId={poll.id} userId={userId} room={room} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
