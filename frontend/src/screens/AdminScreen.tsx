import { useEffect, useState } from "react";
import { LockPersonIcon, PrintIcon, AccountCircleIcon, ChatIcon, RecyclingIcon } from "../components/KioskIcons";
import { API } from "../config";

interface Props { onBack: () => void; }
type Tab = "logs" | "users" | "transactions" | "feedback" | "admins";
type Role = "admin" | "super_admin";

interface User {
  rfid: string; name: string; studentId: string;
  credits: number; created_at: string;
}
interface Transaction {
  id: number; rfid: string; type: string; size?: string;
  height_mm?: number; weight_g?: number; credits: number; created_at: string;
}
interface Feedback {
  id: number; rfid: string | null; context: string;
  rating: number; comment: string; created_at: string;
}
interface AdminAccount {
  id: number; username: string; role: Role; created_at: string;
}

export default function AdminScreen({}: Props) {
  const [token, setToken]           = useState<string | null>(null);
  const [myAdminId, setMyAdminId]   = useState<number | null>(null);
  const [myUsername, setMyUsername] = useState<string>("");
  const [myRole, setMyRole]         = useState<Role>("admin");
  const [passwordChanged, setPasswordChanged] = useState<boolean>(true);
  
  const verified = token !== null;
  const isSuperAdmin = myRole === "super_admin";

  // login step flow state ("username" -> "password")
  const [loginStep, setLoginStep]   = useState<"username" | "password">("username");
  const [userInput, setUserInput]   = useState("");
  const [userCheckLoading, setUserCheckLoading] = useState(false);
  const [userError, setUserError]   = useState("");

  const [pwInput, setPwInput]       = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pwError, setPwError]       = useState("");
  const [pwLoading, setPwLoading]   = useState(false);

  // Lockout timer state
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [lockoutRemaining, setLockoutRemaining] = useState<number>(0);

  // Countdown effect
  useEffect(() => {
    if (!lockoutUntil) return;

    const updateTimer = () => {
      const now = Date.now();
      if (now >= lockoutUntil) {
        setLockoutUntil(null);
        setLockoutRemaining(0);
      } else {
        setLockoutRemaining(Math.ceil((lockoutUntil - now) / 1000));
      }
    };

    updateTimer(); // Run immediately
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [lockoutUntil]);

  // forced password change state for first login
  const [forceNewPass, setForceNewPass]     = useState("");
  const [forceConfirmPass, setForceConfirmPass] = useState("");
  const [showForcePass, setShowForcePass]   = useState(false);
  const [forceMsg, setForceMsg]             = useState("");

  const [tab, setTab]               = useState<Tab>("logs");
  const [users, setUsers]           = useState<User[]>([]);
  const [txns, setTxns]             = useState<Transaction[]>([]);
  const [feedback, setFeedback]     = useState<Feedback[]>([]);
  const [admins, setAdmins]         = useState<AdminAccount[]>([]);
  const [loading, setLoading]       = useState(false);
  const [addCredits, setAddCredits] = useState<{ rfid: string; name: string } | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditMsg, setCreditMsg]   = useState("");

  // admin-account modal state (for super-admin managing all admins)
  const [adminModal, setAdminModal] = useState<null | { mode: "create" } | { mode: "edit"; admin: AdminAccount }>(null);
  const [adminForm, setAdminForm]   = useState({ username: "", password: "", role: "admin" as Role });
  const [adminMsg, setAdminMsg]     = useState("");

  // personal account settings modal state (for any logged-in admin)
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsForm, setSettingsForm]     = useState({ username: "", newPassword: "", confirmPassword: "" });
  const [showSettingsPass, setShowSettingsPass] = useState(false);
  const [settingsMsg, setSettingsMsg]       = useState("");

  const authFetch = (path: string, options: RequestInit = {}) => {
    return fetch(`${API}${path}`, {
      ...options,
      headers: {
        ...(options.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });
  };

  useEffect(() => {
    fetch(`${API}/api/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "admin" }),
    });
    return () => {
      fetch(`${API}/api/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "idle" }),
      });
    };
  }, []);

  const handleNextStep = async () => {
    if (!userInput.trim()) return;
    setUserError("");
    setUserCheckLoading(true);

    try {
      const res = await fetch(`${API}/api/admin/check-username`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: userInput.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.exists) {
        setLoginStep("password");
      } else {
        setUserError(data.error ?? "Username not found.");
      }
    } catch {
      setUserError("Could not reach backend.");
    }
    setUserCheckLoading(false);
  };

  const handlePasswordLogin = async () => {
    if (!userInput || !pwInput || lockoutRemaining > 0) return;
    setPwLoading(true);
    setPwError("");
    try {
      const res = await fetch(`${API}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: userInput, password: pwInput }),
      });
      const data = await res.json();
      
      if (res.status === 429 && data.lockoutUntil) {
        setLockoutUntil(data.lockoutUntil);
        setPwError(""); // Clear standard error in favor of lockout message
      } else if (res.ok && data.token) {
        setToken(data.token);
        setMyAdminId(data.adminId);
        setMyUsername(data.username);
        setMyRole(data.role);
        setPasswordChanged(data.passwordChanged);
        setPwInput("");
        setLockoutUntil(null); // Clear lockout on success
      } else {
        setPwError(data.error ?? "Incorrect username or password.");
      }
    } catch {
      setPwError("Could not reach backend.");
    }
    setPwLoading(false);
  };

  const handleForcePasswordChange = async () => {
    if (!forceNewPass || forceNewPass.length < 8) {
      setForceMsg("Password must be at least 8 characters.");
      return;
    }
    if (forceNewPass !== forceConfirmPass) {
      setForceMsg("Passwords do not match.");
      return;
    }

    try {
      const res = await authFetch(`/api/admin/me/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: pwInput || "DefaultPass123!", newPassword: forceNewPass }),
      });
      const data = await res.json();
      if (data.success) {
        setPasswordChanged(true);
      } else {
        setForceMsg(data.error ?? "Failed to update password.");
      }
    } catch {
      setForceMsg("Could not reach backend.");
    }
  };

  const handleSaveSettings = async () => {
    if (!myAdminId) return;
    if (!settingsForm.username.trim()) {
      setSettingsMsg("Username cannot be empty.");
      return;
    }

    const payload: any = { username: settingsForm.username.trim() };
    if (settingsForm.newPassword) {
      if (settingsForm.newPassword.length < 8) {
        setSettingsMsg("New password must be at least 8 characters.");
        return;
      }
      if (settingsForm.newPassword !== settingsForm.confirmPassword) {
        setSettingsMsg("New passwords do not match.");
        return;
      }
      payload.password = settingsForm.newPassword;
    }

    try {
      const res = await authFetch(`/api/admin/admins/${myAdminId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        setMyUsername(settingsForm.username.trim());
        setShowSettingsModal(false);
        setSettingsMsg("");
        fetchData();
      } else {
        setSettingsMsg(data.error ?? "Failed to update profile.");
      }
    } catch {
      setSettingsMsg("Could not reach backend.");
    }
  };

  useEffect(() => {
    if (verified && passwordChanged) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verified, passwordChanged, tab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (tab === "users" || tab === "logs") {
        const r = await authFetch(`/api/admin/users`);
        setUsers(await r.json());
      }
      if (tab === "transactions" || tab === "logs") {
        const r = await authFetch(`/api/admin/transactions`);
        setTxns(await r.json());
      }
      if (tab === "feedback") {
        const r = await authFetch(`/api/admin/feedback`);
        setFeedback(await r.json());
      }
      if (tab === "admins" && isSuperAdmin) {
        const r = await authFetch(`/api/admin/admins`);
        setAdmins(await r.json());
      }
    } catch {}
    setLoading(false);
  };

  const handleResetCredits = async (rfid: string) => {
    await authFetch(`/api/admin/user/${rfid}/reset-credits`, { method: "POST" });
    fetchData();
  };

  const handleDeleteUser = async (rfid: string) => {
    await authFetch(`/api/admin/user/${rfid}`, { method: "DELETE" });
    fetchData();
  };

  const handleAddCredits = async () => {
    if (!addCredits) return;
    const amount = parseInt(creditAmount);
    if (isNaN(amount) || amount <= 0) {
      setCreditMsg("Enter a valid number.");
      return;
    }
    const res = await authFetch(`/api/admin/user/${addCredits.rfid}/add-credits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount }),
    });
    const data = await res.json();
    if (data.success) {
      setCreditMsg(`✅ Added ${amount} credits. New total: ${data.credits}`);
      fetchData();
      setTimeout(() => {
        setAddCredits(null);
        setCreditAmount("");
        setCreditMsg("");
      }, 2000);
    } else {
      setCreditMsg(`❌ ${data.error}`);
    }
  };

  const openCreateAdmin = () => {
    setAdminForm({ username: "", password: "", role: "admin" });
    setAdminMsg("");
    setAdminModal({ mode: "create" });
  };

  const openEditAdmin = (admin: AdminAccount) => {
    setAdminForm({ username: admin.username, password: "", role: admin.role });
    setAdminMsg("");
    setAdminModal({ mode: "edit", admin });
  };

  const handleSaveAdmin = async () => {
    if (!adminModal) return;
    if (adminModal.mode === "create") {
      if (!adminForm.username) {
        setAdminMsg("Username is required.");
        return;
      }
      const res = await authFetch(`/api/admin/admins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: adminForm.username, role: adminForm.role }),
      });
      const data = await res.json();
      if (data.success) {
        setAdminModal(null);
        fetchData();
      } else {
        setAdminMsg(data.error ?? "Failed to create admin.");
      }
    } else {
      const body: any = { username: adminForm.username, role: adminForm.role };
      if (adminForm.password) body.password = adminForm.password;
      const res = await authFetch(`/api/admin/admins/${adminModal.admin.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setAdminModal(null);
        fetchData();
      } else {
        setAdminMsg(data.error ?? "Failed to update admin.");
      }
    }
  };

  const handleDeleteAdmin = async (admin: AdminAccount) => {
    if (!window.confirm(`Delete admin account "${admin.username}"?`)) return;
    const res = await authFetch(`/api/admin/admins/${admin.id}`, { method: "DELETE" });
    const data = await res.json();
    if (!data.success) {
      alert(data.error ?? "Failed to delete admin.");
    }
    fetchData();
  };

  const handleLogout = () => {
    if (window.confirm("Log out of the admin panel?")) {
      setToken(null);
      setPasswordChanged(true);
      setLoginStep("username");
      setUserInput("");
      setTab("logs");
      setShowSettingsModal(false);
    }
  };

  // ── login screen ───────────────────────────────────────────────────────────
  if (!verified) {
    return (
      <div style={fullScreen}>
        <div style={{ ...headerBar, paddingLeft: 24 }}>
          <LockPersonIcon size={22} color="#f0a500" />
          <div>
            <div style={headerTitle}>Admin Access</div>
            <div style={headerSub}>
              {loginStep === "username" ? "Enter your admin username" : `Logging in as: ${userInput}`}
            </div>
          </div>
        </div>
        <div style={loginBody}>
          <div style={loginPanel}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              
              {loginStep === "username" ? (
                <>
                  <div style={{ fontSize: 13, color: "#888", fontWeight: 600 }}>Username</div>
                  <input
                    type="text"
                    value={userInput}
                    onChange={e => setUserInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleNextStep(); }}
                    placeholder="Enter username"
                    autoCapitalize="none"
                    autoFocus
                    style={inputStyle}
                  />

                  {userError && (
                    <div style={{ fontSize: 12, color: "#e74c3c" }}>{userError}</div>
                  )}

                  <button
                    onClick={handleNextStep}
                    disabled={!userInput.trim() || userCheckLoading}
                    style={{
                      padding: "12px", borderRadius: 8, fontWeight: 700, fontSize: 14,
                      border: "none", cursor: !userInput.trim() || userCheckLoading ? "not-allowed" : "pointer",
                      background: !userInput.trim() || userCheckLoading ? "#333" : "#f0a500",
                      color: !userInput.trim() || userCheckLoading ? "#555" : "#000",
                      marginTop: 4,
                    }}
                  >
                    {userCheckLoading ? "Checking..." : "Next"}
                  </button>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 13, color: "#888", fontWeight: 600 }}>Password</div>
                    <button
                      onClick={() => { setLoginStep("username"); setPwInput(""); setPwError(""); }}
                      disabled={lockoutRemaining > 0}
                      style={{ 
                        background: "none", border: "none", color: "#f0a500", 
                        fontSize: 12, cursor: lockoutRemaining > 0 ? "not-allowed" : "pointer" 
                      }}
                    >
                      ← Change username
                    </button>
                  </div>
                  
                  <div style={{ position: "relative" }}>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={pwInput}
                      onChange={e => setPwInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") handlePasswordLogin(); }}
                      placeholder="Enter password"
                      autoFocus
                      disabled={lockoutRemaining > 0}
                      style={{ 
                        ...inputStyle, 
                        paddingRight: 45,
                        opacity: lockoutRemaining > 0 ? 0.5 : 1,
                        cursor: lockoutRemaining > 0 ? "not-allowed" : "text"
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      disabled={lockoutRemaining > 0}
                      style={{
                        position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                        background: "none", border: "none", color: "#888", 
                        cursor: lockoutRemaining > 0 ? "not-allowed" : "pointer", 
                        fontSize: 13
                      }}
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>

                  <div style={{ fontSize: 11, color: "#666", lineHeight: 1.4, marginTop: 2 }}>
                    💡 New admin account? Use the default password: <strong style={{ color: "#aaa" }}>DefaultPass123!</strong>
                  </div>

                  {pwError && !lockoutRemaining && (
                    <div style={{ fontSize: 12, color: "#e74c3c" }}>{pwError}</div>
                  )}

                  {lockoutRemaining > 0 && (
                    <div style={{ fontSize: 13, color: "#e74c3c", fontWeight: 700, textAlign: "center", marginTop: 4 }}>
                       Locked out. Try again in {Math.floor(lockoutRemaining / 60)}:{(lockoutRemaining % 60).toString().padStart(2, '0')}
                    </div>
                  )}

                  <button
                    onClick={handlePasswordLogin}
                    disabled={!pwInput || pwLoading || lockoutRemaining > 0}
                    style={{
                      padding: "12px", borderRadius: 8, fontWeight: 700, fontSize: 14,
                      border: "none", 
                      cursor: !pwInput || pwLoading || lockoutRemaining > 0 ? "not-allowed" : "pointer",
                      background: !pwInput || pwLoading || lockoutRemaining > 0 ? "#333" : "#f0a500",
                      color: !pwInput || pwLoading || lockoutRemaining > 0 ? "#555" : "#000",
                      marginTop: 4,
                    }}
                  >
                    {lockoutRemaining > 0 ? "Locked" : pwLoading ? "Checking..." : "Log in"}
                  </button>
                </>
              )}

            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Force Password Change Screen (First Login) ────────────────────────────
  if (!passwordChanged) {
    return (
      <div style={fullScreen}>
        <div style={{ ...headerBar, paddingLeft: 24 }}>
          <LockPersonIcon size={22} color="#f0a500" />
          <div>
            <div style={headerTitle}>Security Update Required</div>
            <div style={headerSub}>You must change your default password to continue</div>
          </div>
        </div>
        <div style={loginBody}>
          <div style={loginPanel}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 13, color: "#888", fontWeight: 600 }}>New Password</div>
              <div style={{ position: "relative" }}>
                <input
                  type={showForcePass ? "text" : "password"}
                  value={forceNewPass}
                  onChange={e => setForceNewPass(e.target.value)}
                  placeholder="At least 8 characters"
                  style={{ ...inputStyle, paddingRight: 45 }}
                />
                <button
                  type="button"
                  onClick={() => setShowForcePass(!showForcePass)}
                  style={{
                    position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 13
                  }}
                >
                  {showForcePass ? "Hide" : "Show"}
                </button>
              </div>

              <div style={{ fontSize: 13, color: "#888", fontWeight: 600, marginTop: 6 }}>Confirm New Password</div>
              <input
                type="password"
                value={forceConfirmPass}
                onChange={e => setForceConfirmPass(e.target.value)}
                placeholder="Re-enter new password"
                style={inputStyle}
              />

              {forceMsg && (
                <div style={{ fontSize: 12, color: "#e74c3c" }}>{forceMsg}</div>
              )}
              <button
                onClick={handleForcePasswordChange}
                disabled={!forceNewPass || !forceConfirmPass}
                style={{
                  padding: "12px", borderRadius: 8, fontWeight: 700, fontSize: 14,
                  border: "none", cursor: !forceNewPass || !forceConfirmPass ? "not-allowed" : "pointer",
                  background: !forceNewPass || !forceConfirmPass ? "#333" : "#f0a500",
                  color: !forceNewPass || !forceConfirmPass ? "#555" : "#000",
                  marginTop: 4,
                }}
              >
                Update Password & Continue
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Admin panel (after verified & password changed) ───────────────────────
  return (
    <div style={fullScreen}>
      {/* Hidden file input for database restore inside settings */}
      <input
        type="file"
        id="restoreFileInput"
        accept=".json"
        style={{ display: "none" }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;

          if (!window.confirm("WARNING: Restoring a backup file will completely overwrite all current kiosk users, transactions, and settings. Proceed?")) {
            e.target.value = "";
            return;
          }

          try {
            const text = await file.text();
            const json = JSON.parse(text);

            const res = await authFetch(`/api/admin/restore`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(json),
            });
            const data = await res.json();

            if (res.ok && data.success) {
              alert(" System successfully restored from backup!");
              setShowSettingsModal(false);
              fetchData();
            } else {
              alert(` Restore failed: ${data.error ?? "Unknown error"}`);
            }
          } catch {
            alert(" Invalid JSON backup file format.");
          }
          e.target.value = "";
        }}
      />

      {/* Clean header without top-left back arrow */}
      <div style={{ ...headerBar, paddingLeft: 24 }}>
        <LockPersonIcon size={22} color="#f0a500" />
        <div>
          <div style={headerTitle}>Admin Panel</div>
          <div style={headerSub}>Logged in as {myUsername} {isSuperAdmin && "· super-admin"}</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button 
            onClick={() => {
              setSettingsForm({ username: myUsername, newPassword: "", confirmPassword: "" });
              setSettingsMsg("");
              setShowSettingsModal(true);
            }} 
            style={actionBtn("#2a2a2a", "#f0a500")}
          >
             Settings
          </button>
          <button onClick={fetchData} style={refreshBtn}>↻ Refresh</button>
        </div>
      </div>

      {/* tabs */}
      <div style={tabBar}>
        {([
          ["logs", <><PrintIcon size={15} /> Activity Logs</>],
          ["users", <><AccountCircleIcon size={15} /> Manage Users</>],
          ["transactions", <><RecyclingIcon size={15} /> Transactions</>],
          ["feedback", <><ChatIcon size={15} /> Feedback</>],
          ...(isSuperAdmin ? [["admins", <><LockPersonIcon size={15} /> Manage Admins</>] as [Tab, React.ReactNode]] : []),
        ] as [Tab, React.ReactNode][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{
            ...tabBtn,
            color: tab === t ? "#f0a500" : "#666",
            borderBottom: tab === t ? "2px solid #f0a500" : "2px solid transparent",
          }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{label}</span>
          </button>
        ))}
      </div>

      <div style={body}>
        {loading && <div style={{ color: "#666", fontSize: 14 }}>Loading...</div>}

        {/* LOGS TAB */}
        {!loading && tab === "logs" && (
          <div style={tableWrap}>
            <table style={table}>
              <thead>
                <tr>{["Time", "RFID", "Type", "Detail", "Credits"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {txns.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: "center", color: "#555" }}>No activity yet</td></tr>}
                {txns.map(t => (
                  <tr key={t.id} style={{ borderBottom: "1px solid #2a2a2a" }}>
                    <td style={td}>{new Date(t.created_at).toLocaleString()}</td>
                    <td style={{ ...td, fontFamily: "monospace", fontSize: 11, color: "#666" }}>{t.rfid}</td>
                    <td style={td}>
                      <span style={{
                        padding: "2px 8px", borderRadius: 20, fontSize: 11,
                        background: t.type === "deposit" ? "#1a3a2a" : t.type === "admin_credit" ? "#1a2a3a" : t.type === "register" ? "#3a2a1a" : "#1a1a3a",
                        color: t.type === "deposit" ? "#2ecc71" : t.type === "admin_credit" ? "#3498db" : t.type === "register" ? "#f0a500" : "#e74c3c",
                      }}>
                        {t.type}
                      </span>
                    </td>
                    <td style={td}>
                      {t.type === "deposit" 
                        ? `${t.size ?? "—"} · ${t.height_mm ?? "—"}mm · ${t.weight_g ?? "—"}g` 
                        : t.type === "register" 
                        ? (t.size ?? "New user account registered") 
                        : "—"}
                    </td>
                    <td style={{ ...td, color: t.type === "print" ? "#e74c3c" : "#2ecc71", fontWeight: 700 }}>
                      {t.type === "print" ? `-${t.credits}` : `+${t.credits}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* USERS TAB */}
        {!loading && tab === "users" && (
          <div style={tableWrap}>
            <table style={table}>
              <thead>
                <tr>{["Name", "Student ID", "RFID", "Credits", "Registered", "Actions"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {users.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: "center", color: "#555" }}>No users yet</td></tr>}
                {users.map(u => (
                  <tr key={u.rfid} style={{ borderBottom: "1px solid #2a2a2a" }}>
                    <td style={td}>{u.name}</td>
                    <td style={td}>{u.studentId || <span style={{ color: "#444" }}>—</span>}</td>
                    <td style={{ ...td, fontFamily: "monospace", fontSize: 11, color: "#666" }}>{u.rfid}</td>
                    <td style={{ ...td, color: "#f0a500", fontWeight: 700 }}>{u.credits}</td>
                    <td style={{ ...td, fontSize: 11, color: "#555" }}>{new Date(u.created_at).toLocaleDateString()}</td>
                    <td style={td}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => { setAddCredits({ rfid: u.rfid, name: u.name }); setCreditAmount(""); setCreditMsg(""); }}
                          style={actionBtn("#1a2a3a", "#3498db")}
                        >
                          + Credits
                        </button>
                        <button onClick={() => handleResetCredits(u.rfid)} style={actionBtn("#333", "#aaa")}>Reset</button>
                        <button onClick={() => handleDeleteUser(u.rfid)} style={actionBtn("#3a1a1a", "#e74c3c")}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TRANSACTIONS TAB */}
        {!loading && tab === "transactions" && (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
              {[
                { label: "Total users",       val: users.length,                                          color: "#fff" },
                { label: "Bottles deposited", val: txns.filter(t => t.type === "deposit").length,         color: "#2ecc71" },
                { label: "Print jobs",        val: txns.filter(t => t.type === "print").length,           color: "#3498db" },
                { label: "Credits earned",    val: txns.filter(t => t.type !== "print").reduce((a, t) => a + t.credits, 0), color: "#f0a500" },
                { 
                  label: "Plastic Collected", 
                  val: `${(txns.filter(t => t.type === "deposit").reduce((a, t) => a + (t.weight_g ?? 0), 0) / 1000).toFixed(2)} kg`, 
                  color: "#27ae60" 
                },
                { 
                  label: "CO2 Avoided", 
                  val: `${((txns.filter(t => t.type === "deposit").reduce((a, t) => a + (t.weight_g ?? 0), 0) / 1000) * 3).toFixed(2)} kg`, 
                  color: "#1abc9c" 
                },
              ].map(s => (
                <div key={s.label} style={statCard}>
                  <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.val}</div>
                </div>
              ))}
            </div>
            <div style={tableWrap}>
              <table style={table}>
                <thead>
                  <tr>{["#", "Time", "RFID", "Type", "Size", "Credits"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {txns.map(t => (
                    <tr key={t.id} style={{ borderBottom: "1px solid #2a2a2a" }}>
                      <td style={{ ...td, color: "#555" }}>{t.id}</td>
                      <td style={td}>{new Date(t.created_at).toLocaleString()}</td>
                      <td style={{ ...td, fontFamily: "monospace", fontSize: 11, color: "#666" }}>{t.rfid}</td>
                      <td style={td}>{t.type}</td>
                      <td style={td}>{t.size ?? "—"}</td>
                      <td style={{ ...td, color: t.type === "print" ? "#e74c3c" : "#2ecc71", fontWeight: 700 }}>
                        {t.type === "print" ? `-${t.credits}` : `+${t.credits}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* FEEDBACK TAB */}
        {!loading && tab === "feedback" && (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {[
                { label: "Total feedback", val: feedback.length, color: "#fff" },
                {
                  label: "Average rating",
                  val: feedback.length
                    ? (feedback.reduce((a, f) => a + f.rating, 0) / feedback.length).toFixed(1)
                    : "—",
                  color: "#f0a500",
                },
                {
                  label: "With comments",
                  val: feedback.filter(f => f.comment && f.comment.trim().length > 0).length,
                  color: "#3498db",
                },
              ].map(s => (
                <div key={s.label} style={statCard}>
                  <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.val}</div>
                </div>
              ))}
            </div>
            <div style={tableWrap}>
              <table style={table}>
                <thead>
                  <tr>{["Time", "Context", "Rating", "Comment", "RFID"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {feedback.length === 0 && (
                    <tr><td colSpan={5} style={{ ...td, textAlign: "center", color: "#555" }}>No feedback yet</td></tr>
                  )}
                  {feedback.map(f => (
                    <tr key={f.id} style={{ borderBottom: "1px solid #2a2a2a" }}>
                      <td style={td}>{new Date(f.created_at).toLocaleString()}</td>
                      <td style={td}>
                        <span style={{
                          padding: "2px 8px", borderRadius: 20, fontSize: 11,
                          background: f.context === "deposit" ? "#1a3a2a" : f.context === "print" ? "#1a2a3a" : "#2a2a2a",
                          color: f.context === "deposit" ? "#2ecc71" : f.context === "print" ? "#3498db" : "#aaa",
                        }}>
                          {f.context}
                        </span>
                      </td>
                      <td style={{ ...td, color: "#f0a500", fontWeight: 700, letterSpacing: 1 }}>
                        {"★".repeat(f.rating)}{"☆".repeat(5 - f.rating)}
                      </td>
                      <td style={td}>{f.comment ? f.comment : <span style={{ color: "#444" }}>—</span>}</td>
                      <td style={{ ...td, fontFamily: "monospace", fontSize: 11, color: "#666" }}>
                        {f.rfid ?? <span style={{ color: "#444" }}>anon</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* MANAGE ADMINS TAB */}
        {!loading && tab === "admins" && isSuperAdmin && (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={openCreateAdmin} style={{ ...actionBtn("#1a3a2a", "#2ecc71"), padding: "8px 16px", fontSize: 12 }}>
                + New Admin
              </button>
            </div>
            <div style={tableWrap}>
              <table style={table}>
                <thead>
                  <tr>{["Username", "Role", "Created", "Actions"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {admins.length === 0 && <tr><td colSpan={4} style={{ ...td, textAlign: "center", color: "#555" }}>No admins yet</td></tr>}
                  {admins.map(a => (
                    <tr key={a.id} style={{ borderBottom: "1px solid #2a2a2a" }}>
                      <td style={td}>{a.username}</td>
                      <td style={td}>
                        <span style={{
                          padding: "2px 8px", borderRadius: 20, fontSize: 11,
                          background: a.role === "super_admin" ? "#3a2a1a" : "#1e1e1e",
                          color: a.role === "super_admin" ? "#f0a500" : "#aaa",
                        }}>
                          {a.role === "super_admin" ? "super-admin" : "admin"}
                        </span>
                      </td>
                      <td style={{ ...td, fontSize: 11, color: "#555" }}>{new Date(a.created_at).toLocaleDateString()}</td>
                      <td style={td}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => openEditAdmin(a)} style={actionBtn("#1a2a3a", "#3498db")}>Edit</button>
                          <button onClick={() => handleDeleteAdmin(a)} style={actionBtn("#3a1a1a", "#e74c3c")}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Account Settings Modal */}
      {showSettingsModal && (
        <div style={overlay}>
          <div style={{ ...modal, maxWidth: 400 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 20 }}></span>
                <span style={{ fontSize: 17, fontWeight: 700, color: "#fff" }}>Admin Settings</span>
              </div>
              <button
                onClick={handleLogout}
                style={{
                  padding: "6px 12px", borderRadius: 6, fontWeight: 600,
                  fontSize: 12, background: "#2a1a1a", color: "#e74c3c",
                  border: "1px solid #e74c3c44", cursor: "pointer",
                }}
              >
                 Log Out
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, textAlign: "left", maxHeight: 380, overflowY: "auto", paddingRight: 4 }}>
              <div>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Username</div>
                <input
                  value={settingsForm.username}
                  onChange={e => setSettingsForm({ ...settingsForm, username: e.target.value })}
                  style={inputStyle}
                  autoCapitalize="none"
                />
              </div>

              <div>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>New Password (optional)</div>
                <div style={{ position: "relative" }}>
                  <input
                    type={showSettingsPass ? "text" : "password"}
                    value={settingsForm.newPassword}
                    onChange={e => setSettingsForm({ ...settingsForm, newPassword: e.target.value })}
                    placeholder="Leave blank to keep current"
                    style={{ ...inputStyle, paddingRight: 45 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowSettingsPass(!showSettingsPass)}
                    style={{
                      position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                      background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 13
                    }}
                  >
                    {showSettingsPass ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              {settingsForm.newPassword && (
                <div>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Confirm New Password</div>
                  <input
                    type="password"
                    value={settingsForm.confirmPassword}
                    onChange={e => setSettingsForm({ ...settingsForm, confirmPassword: e.target.value })}
                    placeholder="Re-enter new password"
                    style={inputStyle}
                  />
                </div>
              )}

              {/* Super-admin system backup and restore tools inside settings matching Cancel button style */}
              {isSuperAdmin && (
                <div style={{ borderTop: "1px solid #333", paddingTop: 14, marginTop: 4, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 11, color: "#666", fontWeight: 600, letterSpacing: 0.5 }}>SYSTEM MAINTENANCE</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={async () => {
                        try {
                          const res = await authFetch(`/api/admin/backup`);
                          const blob = await res.blob();
                          const url = window.URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `kiosk_database_backup_${new Date().toISOString().slice(0, 10)}.json`;
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                        } catch {
                          alert("Failed to download database backup.");
                        }
                      }}
                      style={ghostBtn}
                    >
                      Download Backup
                    </button>
                    <button
                      onClick={() => document.getElementById("restoreFileInput")?.click()}
                      style={ghostBtn} 
                    >
                     Restore Backup
                    </button>
                  </div>
                </div>
              )}
            </div>

            {settingsMsg && (
              <div style={{ fontSize: 13, color: "#e74c3c", marginTop: 12 }}>{settingsMsg}</div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowSettingsModal(false)} style={ghostBtn}>Cancel</button>
              <button onClick={handleSaveSettings} style={confirmBtn}>Save Profile</button>
            </div>
          </div>
        </div>
      )}

      {/* Add credits modal */}
      {addCredits && (
        <div style={overlay}>
          <div style={modal}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>💳</div>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Add Credits</div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 20 }}>{addCredits.name}</div>
            <input
              type="number"
              value={creditAmount}
              onChange={e => setCreditAmount(e.target.value)}
              placeholder="Enter amount"
              min={1}
              style={{
                width: "100%", padding: "12px 14px", background: "#1e1e1e",
                border: "1px solid #3a3a3a", borderRadius: 8, color: "#fff",
                fontSize: 18, textAlign: "center", outline: "none", marginBottom: 12,
              }}
            />
            {creditMsg && (
              <div style={{ fontSize: 13, color: creditMsg.startsWith("✅") ? "#2ecc71" : "#e74c3c", marginBottom: 12 }}>
                {creditMsg}
              </div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { setAddCredits(null); setCreditAmount(""); setCreditMsg(""); }} style={ghostBtn}>
                Cancel
              </button>
              <button onClick={handleAddCredits} style={confirmBtn}>
                Add Credits
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit admin modal (Super Admin tool) */}
      {adminModal && (
        <div style={overlay}>
          <div style={modal}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🔑</div>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 20 }}>
              {adminModal.mode === "create" ? "New Admin Account" : `Edit "${adminModal.admin.username}"`}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, textAlign: "left" }}>
              <div>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Username</div>
                <input
                  value={adminForm.username}
                  onChange={e => setAdminForm({ ...adminForm, username: e.target.value })}
                  style={inputStyle}
                  autoCapitalize="none"
                />
              </div>

              {adminModal.mode === "edit" && (
                <div>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>
                    New password (leave blank to keep current)
                  </div>
                  <input
                    type="password"
                    value={adminForm.password}
                    onChange={e => setAdminForm({ ...adminForm, password: e.target.value })}
                    placeholder="••••••••"
                    style={inputStyle}
                  />
                </div>
              )}

              <div>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Role</div>
                <select
                  value={adminForm.role}
                  onChange={e => setAdminForm({ ...adminForm, role: e.target.value as Role })}
                  style={{ ...inputStyle, cursor: "pointer" }}
                >
                  <option value="admin">Admin</option>
                  <option value="super_admin">Super-admin</option>
                </select>
              </div>
            </div>

            {adminMsg && (
              <div style={{ fontSize: 13, color: "#e74c3c", marginTop: 12 }}>{adminMsg}</div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={() => setAdminModal(null)} style={ghostBtn}>Cancel</button>
              <button onClick={handleSaveAdmin} style={confirmBtn}>
                {adminModal.mode === "create" ? "Create" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const fullScreen: React.CSSProperties = {
  width: "100%", maxWidth: 1024, minHeight: "100svh", background: "#1a1a1a",
  display: "flex", flexDirection: "column", position: "relative",
  fontFamily: "'Inter', 'Segoe UI', sans-serif", overflow: "hidden",
};
const headerBar: React.CSSProperties = {
  padding: "12px 24px", borderBottom: "1px solid #2a2a2a",
  display: "flex", alignItems: "center", gap: 12,
};
const headerTitle: React.CSSProperties = { fontWeight: 700, fontSize: 15, color: "#fff" };
const headerSub: React.CSSProperties = { fontSize: 11, color: "#555" };
const tabBar: React.CSSProperties = { display: "flex", borderBottom: "1px solid #2a2a2a", paddingLeft: 24 };
const tabBtn: React.CSSProperties = {
  padding: "10px 20px", background: "none", border: "none",
  cursor: "pointer", fontSize: 13, fontWeight: 600, transition: "color 0.2s",
};
const body: React.CSSProperties = {
  flex: 1, overflow: "hidden", padding: "16px 24px",
  display: "flex", flexDirection: "column",
};
const loginBody: React.CSSProperties = {
  flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
  padding: 24, boxSizing: "border-box",
};
const loginPanel: React.CSSProperties = {
  width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 28,
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "12px 14px", background: "#1e1e1e",
  border: "1px solid #3a3a3a", borderRadius: 8, color: "#fff",
  fontSize: 15, outline: "none", boxSizing: "border-box",
};
const tableWrap: React.CSSProperties = {
  flex: 1, overflow: "auto", borderRadius: 10, border: "1px solid #2a2a2a",
};
const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const th: React.CSSProperties = {
  padding: "10px 14px", textAlign: "left", color: "#555",
  fontSize: 11, fontWeight: 600, letterSpacing: 0.5,
  background: "#1e1e1e", borderBottom: "1px solid #2a2a2a",
  position: "sticky", top: 0,
};
const td: React.CSSProperties = { padding: "10px 14px", color: "#ccc", verticalAlign: "middle" };
const actionBtn = (bg: string, color: string): React.CSSProperties => ({
  padding: "4px 10px", borderRadius: "6px", border: "none",
  background: bg, color, fontSize: 11, cursor: "pointer", fontWeight: 600,
});
const statCard: React.CSSProperties = {
  background: "#242424", border: "1px solid #2a2a2a", borderRadius: 10, padding: "14px 16px",
};
const refreshBtn: React.CSSProperties = {
  padding: "6px 14px", borderRadius: 8,
  background: "#2a2a2a", border: "1px solid #3a3a3a",
  color: "#aaa", fontSize: 12, cursor: "pointer",
};
const overlay: React.CSSProperties = {
  position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
};
const modal: React.CSSProperties = {
  background: "#242424", border: "1px solid #444", borderRadius: 16,
  padding: "32px 36px", textAlign: "center", maxWidth: 340, width: "100%",
};
const ghostBtn: React.CSSProperties = {
  flex: 1, padding: "11px", borderRadius: 8, fontWeight: 600,
  fontSize: 14, background: "transparent", color: "#aaa",
  border: "1px solid #3a3a3a", cursor: "pointer",
};
const confirmBtn: React.CSSProperties = {
  flex: 1, padding: "11px", borderRadius: 8, fontWeight: 700,
  fontSize: 14, background: "#f0a500", color: "#000",
  border: "none", cursor: "pointer",
};