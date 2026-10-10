'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import '../operator.css';

export default function AdminLogin() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Login failed');
        setLoading(false);
        return;
      }

      router.push('/admin');
    } catch (err) {
      setError('An error occurred. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="operator-desktop min-h-screen flex items-center justify-center p-4">
      <div className="twitch-card p-8 w-full max-w-md">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-twitch-text mb-2">Admin Login</h1>
          <p className="text-twitch-text-alt">Enter admin credentials to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-twitch-text mb-2">
              Admin Password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="twitch-input w-full min-h-[44px]"
              placeholder="Enter admin password"
              required
              disabled={loading}
            />
          </div>

          {error && (
            <div role="alert" className="bg-error/10 border border-error text-error px-4 py-3 rounded text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full twitch-button disabled:bg-twitch-gray disabled:cursor-not-allowed min-h-[44px]"
          >
            {loading ? 'Authenticating...' : 'Login as Admin'}
          </button>
          
          <a 
            href="/"
            className="block text-center text-twitch-text-alt hover:text-twitch-text text-sm transition-colors py-2 min-h-[44px] flex items-center justify-center"
          >
            ← Back to home
          </a>
        </form>
      </div>
    </div>
  );
}
