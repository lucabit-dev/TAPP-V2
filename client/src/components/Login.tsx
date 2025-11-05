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
    <div className="min-h-screen flex items-center justify-center bg-[#14130e] text-[#eae9e9]">
      <div className="w-full max-w-sm bg-[#14130e] border border-[#2a2820] rounded-xl p-8 shadow-xl">
        <div className="flex items-center justify-center mb-8">
          <img src="/images/logo.png" alt="ASTOR" className="h-12 w-auto" />
        </div>
        <h1 className="text-2xl font-semibold mb-2 text-center">Welcome to ASTOR</h1>
        <p className="text-sm text-center mb-6 opacity-70">Advanced Trading Platform</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm mb-2 opacity-80">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-[#0f0e0a] border border-[#2a2820] text-[#eae9e9] focus:outline-none focus:ring-1 focus:ring-[#eae9e9] focus:border-[#3d3a30] transition-all"
              required
            />
          </div>
          <div>
            <label className="block text-sm mb-2 opacity-80">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-[#0f0e0a] border border-[#2a2820] text-[#eae9e9] focus:outline-none focus:ring-1 focus:ring-[#eae9e9] focus:border-[#3d3a30] transition-all"
              required
            />
          </div>
          {error && (
            <div className="text-sm text-[#f87171] bg-[#f87171]/10 border border-[#f87171]/20 rounded-lg px-3 py-2">{error}</div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-[#eae9e9] text-[#14130e] hover:bg-[#d4d3d3] disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-all duration-200"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}


