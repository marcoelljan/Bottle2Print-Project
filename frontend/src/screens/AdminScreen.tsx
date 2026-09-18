import { useEffect, useState, useRef } from "react";
import {
  AccountCircleIcon,
  ChatIcon,
  CheckCircleIcon,
  EditIcon,
  InfoIcon,
  KeyIcon,
  LockPersonIcon,
  LogOutIcon,
  PrintIcon,
  RecyclingIcon,
  SettingsIcon,
  StarIcon,
  WrenchIcon,
  XCircleIcon,
} from "../components/KioskIcons";
import { API } from "../config";

interface Props { onBack: () => void; }
type Tab = "logs" | "users" | "transactions" | "feedback" | "admins";
type Role = "admin" | "super_admin";

interface User {
  rfid: string; name: string; studentId: string;
  credits: number; created_at: string;
}
interface Transaction {
  id: number; 
  rfid: string; 
  user_name?: string;
  type: string; 
  size?: string;
  height_mm?: number; 
  weight_g?: number; 
  credits: number; 
  created_at: string;
}

interface ActivityLog {
  id: number; admin_user: string; action: string; details: string; created_at: string;
}
interface Feedback {
  id: number; rfid: string | null; context: string;
  rating: number; comment: string; created_at: string;
}
interface AdminAccount {
  id: number; username: string; email: string; role: Role; created_at: string;
}

const formatPhTime = (dateString: string) => {
  if (!dateString) return "—";
  try {
    const normalized = dateString.endsWith("Z") || dateString.includes("+") ? dateString : dateString + "Z";
    return new Date(normalized).toLocaleString("en-US", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return dateString;
  }
};

export default function AdminScreen({}: Props) {
  const [token, setToken]           = useState<string | null>(null);
  const [myAdminId, setMyAdminId]   = useState<number | null>(null);
  const [myUsername, setMyUsername] = useState<string>("");
  const [myEmail, setMyEmail]       = useState<string>("");
  const [myRole, setMyRole]         = useState<Role>("admin");
  const [passwordChanged, setPasswordChanged] = useState<boolean>(true);
  
  const verified = token !== null;
  const isSuperAdmin = myRole === "super_admin";

  const [authView, setAuthView]     = useState<"login" | "forgot" | "reset">("login");
  const [loginStep, setLoginStep]   = useState<"username" | "password">("username");
  const [userInput, setUserInput]   = useState("");
  const [userCheckLoading, setUserCheckLoading] = useState(false);
  const [userError, setUserError]   = useState("");

  const [pwInput, setPwInput]       = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pwError, setPwError]       = useState("");
  const [pwLoading, setPwLoading]   = useState(false);

  const [forgotUsername, setForgotUsername] = useState("");
  const [forgotEmail, setForgotEmail]       = useState("");
  const [forgotMsg, setForgotMsg]           = useState("");
  const [forgotLoading, setForgotLoading]   = useState(false);

  const [resetToken, setResetToken]         = useState<string | null>(null);
  const [newResetPass, setNewResetPass]     = useState("");
  const [resetConfirmPass, setResetConfirmPass] = useState("");
  const [showResetPass, setShowResetPass]   = useState(false);
  const [resetMsg, setResetMsg]             = useState("");

  // Overall System Stats State
  const [stats, setStats] = useState({
    totalBottles: 0,
    totalPlasticKg: "0.00",
    totalCo2G: 0,
    totalPrints: 0,
    totalUsers: 0,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get("reset_token");
    if (tokenParam) {
      setResetToken(tokenParam);
      setAuthView("reset");
    }
  }, []);

  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [lockoutRemaining, setLockoutRemaining] = useState<number>(0);

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
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [lockoutUntil]);

  const [forceNewPass, setForceNewPass]     = useState("");
  const [forceConfirmPass, setForceConfirmPass] = useState("");
  const [showForcePass, setShowForcePass]   = useState(false);
  const [forceMsg, setForceMsg]             = useState("");

  const [tab, setTab]               = useState<Tab>("logs");
  const [users, setUsers]           = useState<User[]>([]);
  const [txns, setTxns]             = useState<Transaction[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [feedback, setFeedback]     = useState<Feedback[]>([]);
  const [admins, setAdmins]         = useState<AdminAccount[]>([]);
  const [loading, setLoading]       = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterValue, setFilterValue] = useState("all");
  const [dateFilter, setDateFilter] = useState("");

  useEffect(() => {
    setSearchQuery("");
    setFilterValue("all");
    setDateFilter("");
  }, [tab]);

  const [editUserModal, setEditUserModal] = useState<User | null>(null);
  const [editName, setEditName]       = useState("");
  const [editStudentId, setEditStudentId] = useState("");
  const [editMsg, setEditMsg]         = useState("");

  const [adminModal, setAdminModal] = useState<null | { mode: "create" } | { mode: "edit"; admin: AdminAccount }>(null);
  const [adminForm, setAdminForm]   = useState({ username: "", email: "", password: "", role: "admin" as Role });
  const [adminMsg, setAdminMsg]     = useState("");
  const [createdDefaultPassNotice, setCreatedDefaultPassNotice] = useState<string | null>(null);

  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [showAccountModal, setShowAccountModal] = useState(false);
  const [settingsForm, setSettingsForm]     = useState({ username: "", email: "", newPassword: "", confirmPassword: "" });
  const [showSettingsPass, setShowSettingsPass] = useState(false);
  const [settingsMsg, setSettingsMsg]       = useState("");

  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
        setPwError("");
      } else if (res.ok && data.token) {
        setToken(data.token);
        setMyAdminId(data.adminId);
        setMyUsername(data.username);
        setMyEmail(data.email || "");
        setMyRole(data.role);
        setPasswordChanged(data.passwordChanged);
        setPwInput("");
        setLockoutUntil(null);
      } else {
        setPwError(data.error ?? "Incorrect username or password.");
      }
    } catch {
      setPwError("Could not reach backend.");
    }
    setPwLoading(false);
  };

  const handleForgotPasswordRequest = async () => {
    if (!forgotUsername.trim() || !forgotEmail.trim()) return;
    setForgotLoading(true);
    setForgotMsg("");
    try {
      const res = await fetch(`${API}/api/admin/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: forgotUsername.trim(), email: forgotEmail.trim() }),
      });
      const data = await res.json();
      setForgotMsg(data.message || data.error);
    } catch {
      setForgotMsg("Could not reach backend.");
    }
    setForgotLoading(false);
  };

  const handleResetPasswordSubmit = async () => {
    if (!newResetPass || newResetPass.length < 8) {
      setResetMsg("Password must be at least 8 characters.");
      return;
    }
    if (newResetPass !== resetConfirmPass) {
      setResetMsg("Passwords do not match.");
      return;
    }
    try {
      const res = await fetch(`${API}/api/admin/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken, newPassword: newResetPass }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setResetMsg("Password successfully reset! Redirecting to login...");
        setTimeout(() => {
          window.location.href = "/?screen=admin";
        }, 2000);
      } else {
        setResetMsg(data.error ?? "Reset failed.");
      }
    } catch {
      setResetMsg("Could not reach backend.");
    }
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

    const payload: any = { 
      username: settingsForm.username.trim(),
      email: settingsForm.email.trim()
    };
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
        setMyEmail(settingsForm.email.trim());
        setShowAccountModal(false);
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
  }, [verified, passwordChanged, tab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const statsRes = await authFetch(`/api/admin/stats`);
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }

      if (tab === "logs") {
        const r = await authFetch(`/api/admin/activity-logs`);
        setActivityLogs(await r.json());
      }
      if (tab === "users") {
        const r = await authFetch(`/api/admin/users`);
        setUsers(await r.json());
      }
      if (tab === "transactions") {
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

  const handleDeleteUser = async (rfid: string) => {
    if (!window.confirm("Are you sure you want to delete this user?")) return;
    await authFetch(`/api/admin/user/${rfid}`, { method: "DELETE" });
    fetchData();
  };

  const openCreateAdmin = () => {
    setAdminForm({ username: "", email: "", password: "", role: "admin" });
    setAdminMsg("");
    setCreatedDefaultPassNotice(null);
    setAdminModal({ mode: "create" });
  };

  const openEditAdmin = (admin: AdminAccount) => {
    setAdminForm({ username: admin.username, email: admin.email || "", password: "", role: admin.role });
    setAdminMsg("");
    setCreatedDefaultPassNotice(null);
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
        body: JSON.stringify({ username: adminForm.username, email: adminForm.email, role: adminForm.role }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCreatedDefaultPassNotice(data.defaultPassword || "DefaultPass123!");
        fetchData();
      } else {
        setAdminMsg(data.error ?? "Failed to create admin.");
      }
    } else {
      const body: any = { username: adminForm.username, email: adminForm.email, role: adminForm.role };
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
    if (!data.success) alert(data.error ?? "Failed to delete admin.");
    fetchData();
  };

  const handleLogout = () => {
    if (window.confirm("Log out of the admin panel?")) {
      setToken(null);
      setPasswordChanged(true);
      setLoginStep("username");
      setUserInput("");
      setTab("logs");
      setShowDropdown(false);
      setShowAccountModal(false);
      setShowMaintenanceModal(false);
    }
  };

  if (!verified) {
    return (
      <div style={fullScreen}>
        <div style={{ ...headerBar, paddingLeft: 24 }}>
          <LockPersonIcon size={22} color="#f0a500" />
          <div>
            <div style={headerTitle}>Admin Access</div>
            <div style={headerSub}>
              {authView === "reset" ? "Reset your password" : authView === "forgot" ? "Password Recovery" : loginStep === "username" ? "Enter your admin username" : `Logging in as: ${userInput}`}
            </div>
          </div>
        </div>
        <div style={loginBody}>
          <div style={loginPanel}>
            {authView === "reset" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 13, color: "#888", fontWeight: 600 }}>New Password</div>
                <div style={{ position: "relative" }}>
                  <input
                    type={showResetPass ? "text" : "password"}
                    value={newResetPass}
                    onChange={e => setNewResetPass(e.target.value)}
                    placeholder="At least 8 characters"
                    style={{ ...inputStyle, paddingRight: 45 }}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPass(!showResetPass)}
                    style={{
                      position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                      background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 13
                    }}
                  >
                    {showResetPass ? "Hide" : "Show"}
                  </button>
                </div>

                <div style={{ fontSize: 13, color: "#888", fontWeight: 600, marginTop: 4 }}>Confirm New Password</div>
                <input
                  type="password"
                  value={resetConfirmPass}
                  onChange={e => setResetConfirmPass(e.target.value)}
                  placeholder="Re-enter new password"
                  style={inputStyle}
                />

                {resetMsg && <div style={{ fontSize: 12, color: resetMsg.startsWith("Password successfully") ? "#2ecc71" : "#e74c3c", display: "flex", alignItems: "center", gap: 6 }}>
                  {resetMsg.startsWith("Password successfully") ? <CheckCircleIcon size={15} color="#2ecc71" /> : <XCircleIcon size={15} color="#e74c3c" />} {resetMsg}
                </div>}
                
                <button
                  onClick={handleResetPasswordSubmit}
                  disabled={!newResetPass || !resetConfirmPass}
                  style={{
                    padding: "12px", borderRadius: 8, fontWeight: 700, 
                    background: !newResetPass || !resetConfirmPass ? "#333" : "#f0a500", 
                    color: !newResetPass || !resetConfirmPass ? "#555" : "#000", 
                    border: "none", cursor: !newResetPass || !resetConfirmPass ? "not-allowed" : "pointer", marginTop: 4 
                  }}
                >
                  Update Password
                </button>
              </div>
            ) : authView === "forgot" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 13, color: "#888", fontWeight: 600 }}>Username</div>
                <input
                  type="text"
                  value={forgotUsername}
                  onChange={e => setForgotUsername(e.target.value)}
                  placeholder="Enter admin username"
                  style={inputStyle}
                  autoFocus
                />
                <div style={{ fontSize: 13, color: "#888", fontWeight: 600, marginTop: 4 }}>Registered Gmail Address</div>
                <input
                  type="email"
                  value={forgotEmail}
                  onChange={e => setForgotEmail(e.target.value)}
                  placeholder="Enter exact account Gmail"
                  style={inputStyle}
                />
                {forgotMsg && <div style={{ fontSize: 12, color: forgotMsg.startsWith("Password") ? "#2ecc71" : "#f0a500", lineHeight: 1.4 }}>{forgotMsg}</div>}
                <button
                  onClick={handleForgotPasswordRequest}
                  disabled={!forgotUsername.trim() || !forgotEmail.trim() || forgotLoading}
                  style={{ padding: "12px", borderRadius: 8, fontWeight: 700, background: "#f0a500", color: "#000", border: "none", cursor: "pointer", marginTop: 4 }}
                >
                  {forgotLoading ? "Sending..." : "Send Reset Link"}
                </button>
                <button
                  onClick={() => { setAuthView("login"); setForgotMsg(""); }}
                  style={{ background: "none", border: "none", color: "#888", fontSize: 12, cursor: "pointer", marginTop: 4 }}
                >
                  ← Back to Log In
                </button>
              </div>
            ) : loginStep === "username" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
                {userError && <div style={{ fontSize: 12, color: "#e74c3c" }}>{userError}</div>}
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
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 13, color: "#888", fontWeight: 600 }}>Password</div>
                  <button
                    onClick={() => { setLoginStep("username"); setPwInput(""); setPwError(""); }}
                    disabled={lockoutRemaining > 0}
                    style={{ background: "none", border: "none", color: "#f0a500", fontSize: 12, cursor: lockoutRemaining > 0 ? "not-allowed" : "pointer" }}
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
                    style={{ ...inputStyle, paddingRight: 45, opacity: lockoutRemaining > 0 ? 0.5 : 1 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={lockoutRemaining > 0}
                    style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 13 }}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>

                <button
                  onClick={() => setAuthView("forgot")}
                  style={{ background: "none", border: "none", color: "#f0a500", fontSize: 12, cursor: "pointer", textAlign: "left", padding: 0 }}
                >
                  Forgot password?
                </button>

                {pwError && !lockoutRemaining && <div style={{ fontSize: 12, color: "#e74c3c" }}>{pwError}</div>}
                {lockoutRemaining > 0 && (
                  <div style={{ fontSize: 13, color: "#e74c3c", fontWeight: 700, textAlign: "center", marginTop: 4 }}>
                     Locked out. Try again in {Math.floor(lockoutRemaining / 60)}:{(lockoutRemaining % 60).toString().padStart(2, '0')}
                  </div>
                )}
                <button
                  onClick={handlePasswordLogin}
                  disabled={!pwInput || pwLoading || lockoutRemaining > 0}
                  style={{
                    padding: "12px", borderRadius: 8, fontWeight: 700, fontSize: 14, border: "none",
                    cursor: !pwInput || pwLoading || lockoutRemaining > 0 ? "not-allowed" : "pointer",
                    background: !pwInput || pwLoading || lockoutRemaining > 0 ? "#333" : "#f0a500",
                    color: !pwInput || pwLoading || lockoutRemaining > 0 ? "#555" : "#000",
                    marginTop: 4,
                  }}
                >
                  {lockoutRemaining > 0 ? "Locked" : pwLoading ? "Checking..." : "Log in"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

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
                  style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 13 }}
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
              {forceMsg && <div style={{ fontSize: 12, color: "#e74c3c" }}>{forceMsg}</div>}
              <button
                onClick={handleForcePasswordChange}
                disabled={!forceNewPass || !forceConfirmPass}
                style={{
                  padding: "12px", borderRadius: 8, fontWeight: 700, fontSize: 14, border: "none",
                  cursor: !forceNewPass || !forceConfirmPass ? "not-allowed" : "pointer",
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

  return (
    <div style={fullScreen}>
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
              alert("System successfully restored from backup!");
              setShowMaintenanceModal(false);
              fetchData();
            } else {
              alert(`Restore failed: ${data.error ?? "Unknown error"}`);
            }
          } catch {
            alert("Invalid JSON backup file format.");
          }
          e.target.value = "";
        }}
      />

      <div style={{ ...headerBar, paddingLeft: 24 }}>
        <LockPersonIcon size={22} color="#f0a500" />
        <div>
          <div style={headerTitle}>Admin Panel</div>
          <div style={headerSub}>Logged in as {myUsername} {isSuperAdmin && "· super-admin"}</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, position: "relative" }} ref={dropdownRef}>
          <button onClick={() => setShowDropdown(!showDropdown)} style={actionBtn("#2a2a2a", "#f0a500")}>
            <SettingsIcon size={15} /> Settings ▾
          </button>
          
          {showDropdown && (
            <div style={dropdownMenu}>
              <button
                onClick={() => {
                  setShowDropdown(false);
                  setSettingsForm({ username: myUsername, email: myEmail, newPassword: "", confirmPassword: "" });
                  setSettingsMsg("");
                  setShowAccountModal(true);
                }}
                style={dropdownItem}
              >
                <AccountCircleIcon size={16} /> Account Settings
              </button>
              
              {isSuperAdmin && (
                <button
                  onClick={() => {
                    setShowDropdown(false);
                    setShowMaintenanceModal(true);
                  }}
                  style={dropdownItem}
                >
                  <WrenchIcon size={16} /> System Maintenance
                </button>
              )}

              <div style={{ height: "1px", background: "#333", margin: "4px 0" }} />

              <button onClick={handleLogout} style={{ ...dropdownItem, color: "#e74c3c" }}>
                <LogOutIcon size={16} /> Log Out
              </button>
            </div>
          )}

          <button onClick={fetchData} style={refreshBtn}>↻ Refresh</button>
        </div>
      </div>

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
        {/* Overall System Impact Dashboard */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16, flexShrink: 0 }}>
          <div style={adminStatCard}>
            <div style={adminStatLabel}>Total Bottles Deposited</div>
            <div style={adminStatVal}>{stats.totalBottles}</div>
          </div>
          <div style={adminStatCard}>
            <div style={adminStatLabel}>Plastic Recycled</div>
            <div style={{ ...adminStatVal, color: "#2ecc71", fontSize: 22 }}>{stats.totalPlasticKg} kg</div>
          </div>
          <div style={adminStatCard}>
            <div style={adminStatLabel}>CO2 Saved</div>
            <div style={{ ...adminStatVal, color: "#3498db", fontSize: 22 }}>{stats.totalCo2G} g</div>
          </div>
          <div style={adminStatCard}>
            <div style={adminStatLabel}>Print Jobs Done</div>
            <div style={adminStatVal}>{stats.totalPrints}</div>
          </div>
        </div>

        {loading && <div style={{ color: "#666", fontSize: 14 }}>Loading...</div>}

         {/* 1. ACTIVITY LOGS */}
        {!loading && tab === "logs" && (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12, height: "100%", overflow: "hidden" }}>
            <div style={{ display: "flex", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="Search logs..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ ...inputStyle, maxWidth: 240, padding: "8px 12px", fontSize: 13 }}
              />
             <select
                value={filterValue}
                onChange={e => setFilterValue(e.target.value)}
                style={{ ...inputStyle, maxWidth: 200, padding: "8px 12px", fontSize: 13, cursor: "pointer" }}
              >
                <option value="all">All Actions</option>
                <option value="REGISTER_USER">Register User</option>
                <option value="CREATE_ADMIN">Create Admin</option>
                <option value="EDIT_ADMIN">Edit Admin</option>
                <option value="DELETE_ADMIN">Delete Admin</option>
                <option value="EDIT_USER">Edit User</option>
                <option value="DELETE_USER">Delete User</option>
                <option value="REQUEST_PASSWORD_RESET">Request Password Reset</option>
                <option value="RESET_PASSWORD">Reset Password</option>
                <option value="EXPORT_BACKUP">Export Backup</option>
                <option value="RESTORE_BACKUP">Restore Backup</option>
              </select>
              <input
                type="date"
                value={dateFilter}
                onChange={e => setDateFilter(e.target.value)}
                style={{ ...inputStyle, maxWidth: 140, padding: "8px 12px", fontSize: 13, colorScheme: "dark", cursor: "pointer" }}
              />
              {(searchQuery || filterValue !== "all" || dateFilter) && (
                <button onClick={() => { setSearchQuery(""); setFilterValue("all"); setDateFilter(""); }} style={actionBtn("#2a2a2a", "#aaa")}>Clear</button>
              )}
            </div>
            <div style={{ ...tableWrap, overflowY: "auto", flex: 1 }}>
              <table style={table}>
                <thead>
                  <tr>{["Time", "Admin User", "Action", "Details"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {activityLogs
                    .filter(l => {
                      const q = searchQuery.toLowerCase();
                      const matchesSearch = l.admin_user.toLowerCase().includes(q) || l.action.toLowerCase().includes(q) || (l.details && l.details.toLowerCase().includes(q));
                      const matchesFilter = filterValue === "all" || l.action === filterValue;
                      const matchesDate = !dateFilter || l.created_at.startsWith(dateFilter);
                      return matchesSearch && matchesFilter && matchesDate;
                    })
                    .map(l => (
                      <tr key={l.id} style={{ borderBottom: "1px solid #2a2a2a" }}>
                        <td style={td}>{formatPhTime(l.created_at)}</td>
                        <td style={{ ...td, fontWeight: 600, color: "#f0a500" }}>{l.admin_user}</td>
                        <td style={td}><span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, background: "#2a2a2a", color: "#fff" }}>{l.action}</span></td>
                        <td style={td}>{l.details}</td>
                      </tr>
                    ))}
                  {activityLogs.length === 0 && <tr><td colSpan={4} style={{ ...td, textAlign: "center", color: "#555" }}>No activity logs recorded yet</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
         {/* 2. MANAGE USERS */}
        {!loading && tab === "users" && (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12, height: "100%", overflow: "hidden" }}>
            <div style={{ display: "flex", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="Search users name, ID, RFID..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ ...inputStyle, maxWidth: 240, padding: "8px 12px", fontSize: 13 }}
              />
              <select
                value={filterValue}
                onChange={e => setFilterValue(e.target.value)}
                style={{ ...inputStyle, maxWidth: 180, padding: "8px 12px", fontSize: 13, cursor: "pointer" }}
              >
                <option value="all">Default Order</option>
                <option value="credits_asc">Credits: Low to High</option>
                <option value="credits_desc">Credits: High to Low</option>
              </select>
              {(searchQuery || filterValue !== "all") && (
                <button onClick={() => { setSearchQuery(""); setFilterValue("all"); }} style={actionBtn("#2a2a2a", "#aaa")}>Clear</button>
              )}
            </div>
            <div style={{ ...tableWrap, overflowY: "auto", flex: 1 }}>
              <table style={table}>
                <thead>
                  <tr>{["Name", "Student ID", "RFID", "Credits", "Registered", "Actions"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {users
                    .filter(u => {
                      const q = searchQuery.toLowerCase();
                      return u.name.toLowerCase().includes(q) || (u.studentId && u.studentId.toLowerCase().includes(q)) || u.rfid.toLowerCase().includes(q);
                    })
                    .sort((a, b) => {
                      if (filterValue === "credits_asc") return a.credits - b.credits;
                      if (filterValue === "credits_desc") return b.credits - a.credits;
                      return 0;
                    })
                    .map(u => (
                      <tr key={u.rfid} style={{ borderBottom: "1px solid #2a2a2a" }}>
                        <td style={td}>{u.name}</td>
                        <td style={td}>{u.studentId || <span style={{ color: "#444" }}>—</span>}</td>
                        <td style={{ ...td, fontFamily: "monospace", fontSize: 11, color: "#666" }}>{u.rfid}</td>
                        <td style={{ ...td, color: "#f0a500", fontWeight: 700 }}>{u.credits}</td>
                        <td style={{ ...td, fontSize: 11, color: "#555" }}>{new Date(u.created_at).toLocaleDateString()}</td>
                        <td style={td}>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <button onClick={() => { setEditUserModal(u); setEditName(u.name); setEditStudentId(u.studentId); setEditMsg(""); }} style={actionBtn("#1e293b", "#38bdf8")}>Edit</button>
                            <button onClick={() => handleDeleteUser(u.rfid)} style={actionBtn("#3a1a1a", "#e74c3c")}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  {users.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: "center", color: "#555" }}>No users yet</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
         {/* 3. TRANSACTIONS */}
        {!loading && tab === "transactions" && (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12, height: "100%", overflow: "hidden" }}>
            <div style={{ display: "flex", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="Search transactions by name, RFID..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ ...inputStyle, maxWidth: 240, padding: "8px 12px", fontSize: 13 }}
              />
              <select
                value={filterValue}
                onChange={e => setFilterValue(e.target.value)}
                style={{ ...inputStyle, maxWidth: 190, padding: "8px 12px", fontSize: 13, cursor: "pointer" }}
              >
                <option value="all">All Transactions</option>
                <option value="deposit">Bottle Deposits</option>
                <option value="print">Print Jobs</option>
                <option value="transfer">Credit Transfers</option>
              </select>
              <input
                type="date"
                value={dateFilter}
                onChange={e => setDateFilter(e.target.value)}
                style={{ ...inputStyle, maxWidth: 140, padding: "8px 12px", fontSize: 13, colorScheme: "dark", cursor: "pointer" }}
              />
              {(searchQuery || filterValue !== "all" || dateFilter) && (
                <button onClick={() => { setSearchQuery(""); setFilterValue("all"); setDateFilter(""); }} style={actionBtn("#2a2a2a", "#aaa")}>Clear</button>
              )}
            </div>
            <div style={{ ...tableWrap, overflowY: "auto", flex: 1 }}>
              <table style={table}>
                <thead>
                  <tr>{["Name", "Time", "RFID", "Type", "Size", "Credits"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {txns
                    .filter(t => {
                      const q = searchQuery.toLowerCase();
                      const matchesSearch = (t.user_name && t.user_name.toLowerCase().includes(q)) || t.rfid.toLowerCase().includes(q) || t.type.toLowerCase().includes(q) || (t.size && t.size.toLowerCase().includes(q));
                      
                      let matchesFilter = true;
                      if (filterValue === "deposit") matchesFilter = t.type === "deposit";
                      else if (filterValue === "print") matchesFilter = t.type === "print";
                      else if (filterValue === "transfer") matchesFilter = t.type === "transfer_out" || t.type === "transfer_in";

                      const matchesDate = !dateFilter || t.created_at.startsWith(dateFilter);
                      return matchesSearch && matchesFilter && matchesDate;
                    })
                    .map(t => (
                      <tr key={t.id} style={{ borderBottom: "1px solid #2a2a2a" }}>
                        <td style={{ ...td, fontWeight: 600, color: "#fff" }}>{t.user_name ? t.user_name : <span style={{ color: "#e74c3c", fontStyle: "italic" }}>Unknown</span>}</td>
                        <td style={td}>{formatPhTime(t.created_at)}</td>
                        <td style={{ ...td, fontFamily: "monospace", fontSize: 11, color: "#666" }}>{t.rfid}</td>
                        <td style={td}>
                          <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, background: "#2a2a2a", color: "#fff" }}>
                            {t.type}
                          </span>
                        </td>
                        <td style={td}>{t.size ?? "—"}</td>
                       <td style={{  ...td,   color: t.credits > 0 && (t.type === "deposit" || t.type === "transfer_in") ? "#2ecc71" : t.credits < 0 ? "#e74c3c" : "#f0a500",  
                       fontWeight: 700 }}>
                          {t.credits > 0 && (t.type === "deposit" || t.type === "transfer_in") ? `+${t.credits}` : t.credits < 0 ? `-${Math.abs(t.credits)}` : `0`}
                    </td>
                      </tr>
                    ))}
                  {txns.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: "center", color: "#555" }}>No transactions yet</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
         {/* 4. FEEDBACK */}
        {!loading && tab === "feedback" && (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12, height: "100%", overflow: "hidden" }}>
            <div style={{ display: "flex", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="Search feedback context, comment..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ ...inputStyle, maxWidth: 240, padding: "8px 12px", fontSize: 13 }}
              />
              <select
                value={filterValue}
                onChange={e => setFilterValue(e.target.value)}
                style={{ ...inputStyle, maxWidth: 170, padding: "8px 12px", fontSize: 13, cursor: "pointer" }}
              >
                <option value="all">All Ratings</option>
                <option value="5">5 Stars</option>
                <option value="4">4 Stars</option>
                <option value="3">3 Stars</option>
                <option value="1">1-2 Stars</option>
              </select>
              <input
                type="date"
                value={dateFilter}
                onChange={e => setDateFilter(e.target.value)}
                style={{ ...inputStyle, maxWidth: 140, padding: "8px 12px", fontSize: 13, colorScheme: "dark", cursor: "pointer" }}
              />
              {(searchQuery || filterValue !== "all" || dateFilter) && (
                <button onClick={() => { setSearchQuery(""); setFilterValue("all"); setDateFilter(""); }} style={actionBtn("#2a2a2a", "#aaa")}>Clear</button>
              )}
            </div>
            <div style={{ ...tableWrap, overflowY: "auto", flex: 1 }}>
              <table style={table}>
                <thead>
                  <tr>{["Time", "Context", "Rating", "Comment", "RFID"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {feedback
                    .filter(f => {
                      const q = searchQuery.toLowerCase();
                      const matchesSearch = f.context.toLowerCase().includes(q) || (f.comment && f.comment.toLowerCase().includes(q)) || (f.rfid && f.rfid.toLowerCase().includes(q));
                      const matchesFilter = filterValue === "all" || (filterValue === "1" ? f.rating <= 2 : f.rating.toString() === filterValue);
                      const matchesDate = !dateFilter || f.created_at.startsWith(dateFilter);
                      return matchesSearch && matchesFilter && matchesDate;
                    })
                    .map(f => (
                      <tr key={f.id} style={{ borderBottom: "1px solid #2a2a2a" }}>
                        <td style={td}>{formatPhTime(f.created_at)}</td>
                        <td style={td}>{f.context}</td>
                        <td style={{ ...td, color: "#f0a500", fontWeight: 700, display: "flex", gap: 2 }}>
                          {Array.from({ length: f.rating }, (_, i) => <StarIcon key={i} size={14} color="#f0a500" />)}
                        </td>
                        <td style={td}>{f.comment || "—"}</td>
                        <td style={{ ...td, fontFamily: "monospace", fontSize: 11, color: "#666" }}>{f.rfid ?? "anon"}</td>
                      </tr>
                    ))}
                  {feedback.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: "center", color: "#555" }}>No feedback yet</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
         {/* 5. MANAGE ADMINS TAB */}
        {!loading && tab === "admins" && isSuperAdmin && (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12, height: "100%", overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, flexWrap: "wrap", gap: 10 }}>
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  type="text"
                  placeholder="Search admins by username..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  style={{ ...inputStyle, maxWidth: 220, padding: "8px 12px", fontSize: 13 }}
                />
                <select
                  value={filterValue}
                  onChange={e => setFilterValue(e.target.value)}
                  style={{ ...inputStyle, maxWidth: 150, padding: "8px 12px", fontSize: 13, cursor: "pointer" }}
                >
                  <option value="all">All Roles</option>
                  <option value="super_admin">Super-admin</option>
                  <option value="admin">Admin</option>
                </select>
                {(searchQuery || filterValue !== "all") && (
                  <button onClick={() => { setSearchQuery(""); setFilterValue("all"); }} style={actionBtn("#2a2a2a", "#aaa")}>Clear</button>
                )}
              </div>
              <button onClick={openCreateAdmin} style={{ ...actionBtn("#1a3a2a", "#2ecc71"), padding: "8px 16px", fontSize: 12 }}>
                + New Admin
              </button>
            </div>
            <div style={{ ...tableWrap, overflowY: "auto", flex: 1 }}>
              <table style={table}>
                <thead>
                  <tr>{["Username", "Gmail Notification", "Role", "Created", "Actions"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {admins
                    .filter(a => {
                      const q = searchQuery.toLowerCase();
                      const matchesSearch = a.username.toLowerCase().includes(q) || (a.email && a.email.toLowerCase().includes(q));
                      const matchesFilter = filterValue === "all" || a.role === filterValue;
                      return matchesSearch && matchesFilter;
                    })
                    .map(a => (
                      <tr key={a.id} style={{ borderBottom: "1px solid #2a2a2a" }}>
                        <td style={td}>{a.username}</td>
                        <td style={{ ...td, color: a.email ? "#38bdf8" : "#666" }}>{a.email || "Not set"}</td>
                        <td style={td}>
                          <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, background: a.role === "super_admin" ? "#3a2a1a" : "#1e1e1e", color: a.role === "super_admin" ? "#f0a500" : "#aaa" }}>
                            {a.role}
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
                  {admins.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: "center", color: "#555" }}>No admins yet</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>  

      {/* Account Settings Modal */}
      {showAccountModal && (
        <div style={overlay}>
          <div style={{ ...modal, maxWidth: 400 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <AccountCircleIcon size={20} color="#f0a500" />
              <span style={{ fontSize: 17, fontWeight: 700, color: "#fff" }}>Account Settings</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, textAlign: "left" }}>
              <div>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Username</div>
                <input
                  value={settingsForm.username}
                  onChange={e => setSettingsForm({ ...settingsForm, username: e.target.value })}
                  style={inputStyle}
                />
              </div>

              <div>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Gmail Address (for Password Recovery & Alerts)</div>
                <input
                  type="email"
                  value={settingsForm.email}
                  onChange={e => setSettingsForm({ ...settingsForm, email: e.target.value })}
                  placeholder="admin@gmail.com"
                  style={inputStyle}
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
                      position: "absolute", right: 12, top: "50%", transform: "translateY(-50% )",
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
                    style={inputStyle}
                  />
                </div>
              )}
            </div>

            {settingsMsg && <div style={{ fontSize: 13, color: "#e74c3c", marginTop: 12 }}>{settingsMsg}</div>}

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowAccountModal(false)} style={ghostBtn}>Cancel</button>
              <button onClick={handleSaveSettings} style={confirmBtn}>Save Profile</button>
            </div>
          </div>
        </div>
      )}

      {/* System Maintenance Modal */}
      {showMaintenanceModal && isSuperAdmin && (
        <div style={overlay}>
          <div style={{ ...modal, maxWidth: 400 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <WrenchIcon size={20} color="#f0a500" />
              <span style={{ fontSize: 17, fontWeight: 700, color: "#fff" }}>System Maintenance</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, textAlign: "left" }}>
              <div style={{ fontSize: 12, color: "#888", lineHeight: 1.4 }}>
                Export encrypted database backups or restore system state from an existing backup file.
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  onClick={async () => {
                    try {
                      const res = await authFetch(`/api/admin/backup`);
                      const blob = await res.blob();
                      const url = window.URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `kiosk_secure_backup_${new Date().toISOString().slice(0, 10)}.json`;
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                    } catch {
                      alert("Failed to download database backup.");
                    }
                  }}
                  style={{ ...confirmBtn, background: "#2a2a2a", color: "#f0a500", border: "1px solid #3a3a3a" }}
                >
                  Download Backup
                </button>
                <button
                  onClick={() => document.getElementById("restoreFileInput")?.click()}
                  style={{ ...confirmBtn, background: "#2a2a2a", color: "#fff", border: "1px solid #3a3a3a" }}
                >
                  Restore Backup
                </button>
              </div>
            </div>

            <div style={{ display: "flex", marginTop: 24 }}>
              <button onClick={() => setShowMaintenanceModal(false)} style={{ ...ghostBtn, width: "100%" }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Account Modal */}
      {editUserModal && (
        <div style={overlay}>
          <div style={modal}>
            <div style={{ marginBottom: 12 }}><EditIcon size={36} color="#3498db" /></div>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Edit User Account</div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 20 }}>RFID: {editUserModal.rfid}</div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 12, textAlign: "left" }}>
              <div>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Full Name</div>
                <input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Student ID</div>
                <input
                  value={editStudentId}
                  onChange={e => setEditStudentId(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            {editMsg && <div style={{ fontSize: 13, color: editMsg.startsWith("Updated") ? "#2ecc71" : "#e74c3c", marginTop: 12, display: "flex", alignItems: "center", gap: 6 }}>
              {editMsg.startsWith("Updated") ? <CheckCircleIcon size={15} color="#2ecc71" /> : <XCircleIcon size={15} color="#e74c3c" />} {editMsg}
            </div>}

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={() => setEditUserModal(null)} style={ghostBtn}>Cancel</button>
              <button
                onClick={async () => {
                  try {
                    const res = await authFetch(`/api/admin/user/${editUserModal.rfid}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ name: editName, studentId: editStudentId }),
                    });
                    const data = await res.json();
                    if (res.ok && data.success) {
                      setEditMsg("Updated successfully!");
                      setTimeout(() => {
                        setEditUserModal(null);
                        fetchData();
                      }, 1000);
                    } else {
                      setEditMsg(data.error ?? "Update failed.");
                    }
                  } catch {
                    setEditMsg("Network error.");
                  }
                }}
                style={confirmBtn}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Admin Modal with Default Password Guide Notice */}
      {adminModal && (
        <div style={overlay}>
          <div style={modal}>
            <div style={{ marginBottom: 12 }}><KeyIcon size={36} color="#f0a500" /></div>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 20 }}>
              {adminModal.mode === "create" ? "New Admin Account" : `Edit "${adminModal.admin.username}"`}
            </div>

            {createdDefaultPassNotice ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, textAlign: "left" }}>
                <div style={{ background: "#1e3a2a", border: "1px solid #2ecc71", padding: 12, borderRadius: 8, color: "#2ecc71", fontSize: 13, lineHeight: 1.4 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><CheckCircleIcon size={16} /> Admin account successfully created!</span>
                  <br/><br/>
                  Initial default password for first login: <strong>{createdDefaultPassNotice}</strong>
                  <br/><br/>
                  <span style={{ color: "#aaa", fontSize: 11 }}>The new admin will be forced to update this password upon their first login.</span>
                </div>
                <button
                  onClick={() => { setAdminModal(null); fetchData(); }}
                  style={{ ...confirmBtn, marginTop: 8 }}
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 12, textAlign: "left" }}>
                  <div>
                    <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Username</div>
                    <input
                      value={adminForm.username}
                      onChange={e => setAdminForm({ ...adminForm, username: e.target.value })}
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Gmail Address</div>
                    <input
                      type="email"
                      value={adminForm.email}
                      onChange={e => setAdminForm({ ...adminForm, email: e.target.value })}
                      placeholder="admin@gmail.com"
                      style={inputStyle}
                    />
                  </div>

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

                  {adminModal.mode === "create" && (
                    <div style={{ background: "#2a2a1a", border: "1px solid #f0a500", padding: 10, borderRadius: 6, fontSize: 11, color: "#f0a500", lineHeight: 1.4 }}>
                      <InfoIcon size={15} style={{ verticalAlign: "middle", marginRight: 5 }} /> Newly created accounts are automatically assigned the default password: <strong>DefaultPass123!</strong>
                    </div>
                  )}
                </div>

                {adminMsg && <div style={{ fontSize: 13, color: "#e74c3c", marginTop: 12 }}>{adminMsg}</div>}

                <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                  <button onClick={() => setAdminModal(null)} style={ghostBtn}>Cancel</button>
                  <button onClick={handleSaveAdmin} style={confirmBtn}>
                    {adminModal.mode === "create" ? "Create" : "Save"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const fullScreen: React.CSSProperties = {
  width: "100%", height: "100%", flex: 1, background: "#1a1a1a",
  display: "flex", flexDirection: "column", position: "relative",
  fontFamily: "'Inter', 'Segoe UI', sans-serif", overflow: "hidden",
  boxSizing: "border-box",
};
const headerBar: React.CSSProperties = {
  padding: "12px 24px", borderBottom: "1px solid #2a2a2a",
  display: "flex", alignItems: "center", gap: 12, flexShrink: 0,
};
const headerTitle: React.CSSProperties = { fontWeight: 700, fontSize: 15, color: "#fff" };
const headerSub: React.CSSProperties = { fontSize: 11, color: "#555" };
const tabBar: React.CSSProperties = { display: "flex", borderBottom: "1px solid #2a2a2a", paddingLeft: 24, flexShrink: 0 };
const tabBtn: React.CSSProperties = {
  padding: "10px 20px", background: "none", border: "none",
  cursor: "pointer", fontSize: 13, fontWeight: 600,
};
const body: React.CSSProperties = {
  flex: 1, overflow: "hidden", padding: "16px 24px",
  display: "flex", flexDirection: "column", boxSizing: "border-box",
};
const loginBody: React.CSSProperties = {
  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, boxSizing: "border-box",
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
  flex: 1, overflow: "auto", borderRadius: 10, border: "1px solid #2a2a2a", boxSizing: "border-box",
};
const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const th: React.CSSProperties = {
  padding: "10px 14px", textAlign: "left", color: "#555",
  fontSize: 11, fontWeight: 600, background: "#1e1e1e",
  borderBottom: "1px solid #2a2a2a", position: "sticky", top: 0,
};
const td: React.CSSProperties = { padding: "10px 14px", color: "#ccc", verticalAlign: "middle" };
const actionBtn = (bg: string, color: string): React.CSSProperties => ({
  padding: "4px 10px", borderRadius: "6px", border: "none",
  background: bg, color, fontSize: 11, cursor: "pointer", fontWeight: 600,
});
const refreshBtn: React.CSSProperties = {
  padding: "6px 14px", borderRadius: 8, background: "#2a2a2a",
  border: "1px solid #3a3a3a", color: "#aaa", fontSize: 12, cursor: "pointer",
};
const dropdownMenu: React.CSSProperties = {
  position: "absolute", top: "calc(100% + 6px)", right: 0, width: 200,
  background: "#242424", border: "1px solid #3a3a3a", borderRadius: 10,
  boxShadow: "0 8px 24px rgba(0,0,0,0.5)", zIndex: 1000,
  display: "flex", flexDirection: "column", padding: "6px",
};
const dropdownItem: React.CSSProperties = {
  padding: "10px 12px", background: "transparent", border: "none",
  borderRadius: 6, color: "#ddd", fontSize: 13, textAlign: "left",
  cursor: "pointer", fontWeight: 600, display: "flex", alignItems: "center", gap: 8,
};
const overlay: React.CSSProperties = {
  position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
};
const modal: React.CSSProperties = {
  background: "#242424", border: "1px solid #444", borderRadius: 16,
  padding: "32px 36px", textAlign: "center", maxWidth: 340, width: "100%", boxSizing: "border-box",
};
const ghostBtn: React.CSSProperties = {
  flex: 1, padding: "11px", borderRadius: 8, fontWeight: 600, fontSize: 14, background: "transparent", color: "#aaa", border: "1px solid #3a3a3a", cursor: "pointer",
};
const confirmBtn: React.CSSProperties = {
  flex: 1, padding: "11px", borderRadius: 8, fontWeight: 700, fontSize: 14, background: "#f0a500", color: "#000", border: "none", cursor: "pointer",
};
const adminStatCard: React.CSSProperties = {
  background: "#242424", border: "1px solid #333", borderRadius: 12,
  padding: "14px 18px", boxSizing: "border-box",
};
const adminStatLabel: React.CSSProperties = { fontSize: 11, color: "#666", marginBottom: 4, fontWeight: 600, textTransform: "uppercase" };
const adminStatVal: React.CSSProperties = { fontSize: 24, fontWeight: 800, color: "#fff" };