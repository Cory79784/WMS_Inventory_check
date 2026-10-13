import React, { useEffect, useState } from 'react';
import { readLanguage } from '../i18n';
import { languageSafety } from '../i18n/safety';

const labels = {
  zh: ['用户名', '密码', '登录', '退出登录', '登录失败，请重试', '存在未保存的修改，请先保存', '正在验证…'],
  de: ['Benutzername', 'Passwort', 'Anmelden', 'Abmelden', 'Anmeldung fehlgeschlagen', 'Bitte Änderungen zuerst speichern', 'Prüfung…'],
  vi: ['Tên đăng nhập', 'Mật khẩu', 'Đăng nhập', 'Đăng xuất', 'Đăng nhập thất bại', 'Vui lòng lưu thay đổi trước', 'Đang kiểm tra…'],
  ar: ['اسم المستخدم', 'كلمة المرور', 'تسجيل الدخول', 'تسجيل الخروج', 'فشل تسجيل الدخول', 'يرجى حفظ التغييرات أولاً', 'جارٍ التحقق…'],
};
export function SessionGate({ children }: { children: React.ReactNode }) {
  const text = labels[readLanguage()];
  const [user, setUser] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const check = () => fetch('/api/auth/me').then(async response => {
      if (response.ok) { const data = await response.json(); setUser(data.user.name); setOpened(true); }
      else if (response.status === 401) setUser(null);
    }).catch(() => setError(text[4])).finally(() => setChecking(false));
    const expired = () => setUser(null);
    void check();
    window.addEventListener('wms-session-expired', expired);
    window.addEventListener('focus', check);
    const timer = setInterval(check, 60000);
    return () => { clearInterval(timer); window.removeEventListener('focus', check); window.removeEventListener('wms-session-expired', expired); };
  }, []);
  if (checking) return <p className="p-6">{text[6]}</p>;
  return <>
    {!user && <form className="max-w-sm mx-auto mt-16 p-6 bg-white rounded-xl space-y-4" onSubmit={async event => {
      event.preventDefault(); setError('');
      const form = event.currentTarget;
      const values = new FormData(form);
      try {
        const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: values.get('username'), password: values.get('password') }) });
        if (!response.ok) throw new Error(text[4]);
        const data = await response.json(); form.reset(); setUser(data.user.name); setOpened(true);
      } catch { setError(text[4]); }
    }}>
      <h1 className="text-xl font-bold">WMS PDA</h1>
      <label className="block">{text[0]}<input name="username" autoComplete="username" required dir="ltr" className="block border rounded p-3 w-full" /></label>
      <label className="block">{text[1]}<input name="password" type="password" autoComplete="current-password" required className="block border rounded p-3 w-full" /></label>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <button className="bg-blue-600 text-white rounded p-3 w-full">{text[2]}</button>
    </form>}
    {user && <div className="flex justify-end items-center gap-3 px-3 py-1 bg-white text-sm"><span dir="ltr">{user}</span><button onClick={async () => {
      const state = languageSafety();
      if (state.dirty || state.busy) { alert(text[5]); return; }
      try {
        const response = await fetch('/api/auth/logout', { method: 'POST' });
        if (!response.ok) throw new Error();
        window.location.reload();
      } catch { alert(text[4]); }
    }}>{text[3]}</button></div>}
    {/* Keep unsaved drafts alive across session expiry; only authenticated users can see the app. */}
    {opened && <div hidden={!user}>{children}</div>}
  </>;
}
