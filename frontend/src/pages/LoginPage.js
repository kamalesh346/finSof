import { useState } from 'react';
import { useAuth } from '../utils/AuthContext';
import { api } from '../utils/api';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const { login } = useAuth();
  const [form, setForm] = useState({ username: '', password: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.login(form);
      login(res.token, res.user);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--bg)', padding: 20
    }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            fontSize: 40, marginBottom: 8,
            background: 'linear-gradient(135deg, var(--accent), #ff8c69)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
          }}>₹</div>
          <h1 style={{ fontSize: 24, letterSpacing: 2, color: 'var(--text)' }}>FINANCE COLLECT</h1>
          <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>Collection Management System</p>
        </div>
        <div className="card">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Username</label>
              <input
                type="text"
                value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value })}
                required autoFocus
                placeholder="Enter username"
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                required placeholder="Enter password"
              />
            </div>
            <button type="submit" className="btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={loading}>
              {loading ? 'Logging in...' : 'LOGIN'}
            </button>
          </form>
        </div>
        <p style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: 'var(--muted)' }}>
          PWA — Works offline after first load
        </p>
      </div>
    </div>
  );
}
