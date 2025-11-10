import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#14130e] text-[#eae9e9] p-4">
      <div className="w-full max-w-md relative">
        {/* Main login card - matching confirmation modal style */}
        <div className="bg-gradient-to-br from-[#14130e] via-[#0f0e0a] to-[#14130e] border border-[#2a2820] shadow-[0_0_30px_rgba(0,0,0,0.8)] overflow-hidden relative">
          {/* Sci-fi corner accents */}
          <div className="absolute top-0 left-0 w-16 h-16 border-t-2 border-l-2 border-[#22c55e]/30 pointer-events-none"></div>
          <div className="absolute top-0 right-0 w-16 h-16 border-t-2 border-r-2 border-[#22c55e]/30 pointer-events-none"></div>
          <div className="absolute bottom-0 left-0 w-16 h-16 border-b-2 border-l-2 border-[#22c55e]/30 pointer-events-none"></div>
          <div className="absolute bottom-0 right-0 w-16 h-16 border-b-2 border-r-2 border-[#22c55e]/30 pointer-events-none"></div>

          <div className="p-8">
            {/* Logo only - smaller and clean */}
            <div className="flex justify-center mb-8">
              <img src="/images/logo.png" alt="ASTOR" className="h-10 w-auto" />
            </div>

            {/* Login form */}
            <form onSubmit={onSubmit} className="space-y-5">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-[#969696] uppercase tracking-wider">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 bg-[#0f0e0a] border border-[#2a2820] text-[#eae9e9] 
                           focus:outline-none focus:border-[#2a2820] focus:ring-1 focus:ring-[#2a2820]/50 
                           transition-all duration-200 placeholder:text-[#808080]"
                  placeholder="user@example.com"
                  required
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-[#969696] uppercase tracking-wider">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 bg-[#0f0e0a] border border-[#2a2820] text-[#eae9e9] 
                           focus:outline-none focus:border-[#2a2820] focus:ring-1 focus:ring-[#2a2820]/50 
                           transition-all duration-200 placeholder:text-[#808080]"
                  placeholder="••••••••"
                  required
                  disabled={loading}
                />
              </div>

              {/* Error message */}
              {error && (
                <div className="p-3 bg-[#f87171]/10 border border-[#f87171]/30">
                  <div className="flex items-center space-x-2">
                    <svg className="w-4 h-4 text-[#f87171] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm text-[#f87171]">{error}</p>
                  </div>
                </div>
              )}

              {/* Submit button - minimal style */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 text-sm font-medium text-[#eae9e9] bg-[#2a2820] 
                         hover:bg-[#3d3a30] disabled:opacity-50 disabled:cursor-not-allowed 
                         transition-all duration-200 border border-[#2a2820] hover:border-[#3d3a30]"
              >
                {loading ? (
                  <span className="flex items-center justify-center space-x-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Signing in...</span>
                  </span>
                ) : (
                  'Sign in'
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}


