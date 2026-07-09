import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthProvider";
import { z } from "zod";

const emailSchema = z.string().trim().email().max(255);
const passwordSchema = z.string().min(6).max(100);
const nameSchema = z.string().trim().min(1).max(100);

function getErrorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

export default function Auth() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);

  useEffect(() => {
    if (user) navigate("/", { replace: true });
  }, [user, navigate]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      emailSchema.parse(email);
      passwordSchema.parse(password);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigate("/", { replace: true });
    } catch (err: unknown) {
      toast({
        title: "Error",
        description: getErrorMessage(err, "Credenciales inválidas"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      nameSchema.parse(fullName);
      emailSchema.parse(email);
      passwordSchema.parse(password);
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
          data: { full_name: fullName },
        },
      });
      if (error) throw error;
      toast({
        title: "Cuenta creada",
        description: "Revisa tu correo para confirmar o inicia sesión si ya está activa.",
      });
    } catch (err: unknown) {
      toast({
        title: "Error",
        description: getErrorMessage(err, "No se pudo crear la cuenta"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  const particles = [
    { size: 16, left: "8%", top: "15%", delay: "0s", duration: "18s", color: "rgba(249,115,22,0.12)" },
    { size: 40, left: "15%", top: "60%", delay: "-3s", duration: "22s", color: "rgba(138,154,91,0.10)" },
    { size: 24, left: "28%", top: "30%", delay: "-6s", duration: "16s", color: "rgba(249,115,22,0.08)" },
    { size: 56, left: "35%", top: "75%", delay: "-9s", duration: "24s", color: "rgba(23,58,39,0.08)" },
    { size: 12, left: "5%", top: "85%", delay: "-4s", duration: "20s", color: "rgba(138,154,91,0.12)" },
    { size: 32, left: "22%", top: "10%", delay: "-7s", duration: "19s", color: "rgba(249,115,22,0.06)" },
    { size: 48, left: "12%", top: "45%", delay: "-2s", duration: "26s", color: "rgba(23,58,39,0.06)" },
    { size: 20, left: "30%", top: "90%", delay: "-5s", duration: "17s", color: "rgba(249,115,22,0.09)" },
  ];

  const inputStyle: React.CSSProperties = {
    border: "1.5px solid var(--auth-border)",
    borderRadius: "10px",
    backgroundColor: "#fff",
    padding: "12px 16px",
    fontSize: "15px",
    color: "var(--auth-text)",
    transition: "border-color 0.3s, box-shadow 0.3s",
  };

  return (
    <div className="relative min-h-svh overflow-x-hidden overflow-y-auto bg-[#0F1A12]">
      {/* Ken Burns background photo */}
      <img
        src="/login-bg.png"
        alt=""
        className="absolute inset-0 h-full w-full object-cover animate-ken-burns"
      />

      {/* Dark gradient overlay */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: "linear-gradient(90deg, rgba(15,26,18,0.75) 0%, rgba(15,26,18,0.30) 40%, rgba(15,26,18,0.05) 65%)",
        }}
      />

      {/* Floating particles */}
      {particles.map((p, i) => (
        <div
          key={i}
          className="absolute rounded-full animate-particle"
          style={{
            width: p.size,
            height: p.size,
            left: p.left,
            top: p.top,
            backgroundColor: p.color,
            animationDelay: p.delay,
            animationDuration: p.duration,
            filter: "blur(2px)",
          }}
        />
      ))}

      {/* Left column - Form */}
      <div className="relative z-10 flex min-h-svh w-full items-center justify-center px-4 py-6 sm:py-8 lg:absolute lg:inset-y-0 lg:left-0 lg:w-[520px]">
        <div
          className="relative w-full max-w-[460px] animate-fade-slide-up rounded-2xl px-5 py-7 shadow-2xl sm:px-10 sm:py-12"
          style={{
            backgroundColor: "rgba(248, 246, 239, 0.93)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
          }}
        >
          {/* Accent top bar */}
          <div
            className="absolute top-0 left-6 right-6 h-[2px] rounded-full"
            style={{
              background: "linear-gradient(90deg, transparent, #F97316, transparent)",
            }}
          />

          {/* Brand */}
          <div className="mb-5 flex items-center gap-3 form-stagger-1 sm:mb-6">
            <img
              src="/branding/lasarte-logo-horizontal.jpg"
              alt="Lasarte Cítricos S.L."
              className="h-12 w-auto"
            />
            <div>
              <p className="text-xs" style={{ color: "var(--auth-muted)" }}>
                Control de producción citrícola
              </p>
            </div>
          </div>

          {/* Title */}
          <div className="form-stagger-2">
            <h1 className="mb-1 text-2xl font-semibold sm:text-[28px]" style={{ color: "var(--auth-text)" }}>
              Bienvenido
            </h1>
            <p className="mb-6 text-sm sm:mb-8" style={{ color: "var(--auth-muted)" }}>
              Accede al panel de control de producción
            </p>
          </div>

          {/* Form */}
          {!isSignUp ? (
            <form onSubmit={handleSignIn} className="space-y-4 sm:space-y-5">
              <div className="space-y-2 form-stagger-3">
                <Label className="text-sm font-medium" style={{ color: "var(--auth-text)" }}>Correo electrónico</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-12 transition-shadow duration-300 focus:shadow-[0_0_0_4px_rgba(249,115,22,0.15)]"
                  style={inputStyle}
                  onFocus={(e) => { e.target.style.borderColor = "#F97316"; e.target.style.boxShadow = "0 0 0 4px rgba(249,115,22,0.15)"; }}
                  onBlur={(e) => { e.target.style.borderColor = "var(--auth-border)"; e.target.style.boxShadow = "none"; }}
                />
              </div>
              <div className="space-y-2 form-stagger-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label className="text-sm font-medium" style={{ color: "var(--auth-text)" }}>Contraseña</Label>
                  <button
                    type="button"
                    className="text-xs font-medium transition-colors hover:brightness-110"
                    style={{ color: "var(--auth-orange)" }}
                    onClick={(e) => {
                      e.preventDefault();
                      toast({
                        title: "Restablecer contraseña",
                        description: "Funcionalidad próximamente.",
                      });
                    }}
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                </div>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-12 transition-shadow duration-300"
                  style={inputStyle}
                  onFocus={(e) => { e.target.style.borderColor = "#F97316"; e.target.style.boxShadow = "0 0 0 4px rgba(249,115,22,0.15)"; }}
                  onBlur={(e) => { e.target.style.borderColor = "var(--auth-border)"; e.target.style.boxShadow = "none"; }}
                />
              </div>
              <div className="form-stagger-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="relative h-12 w-full overflow-hidden rounded-[10px] text-base font-semibold text-white transition-all duration-200 hover:brightness-110 active:scale-[0.98]"
                  style={{ backgroundColor: "var(--auth-orange)" }}
                >
                  {loading ? "..." : "Iniciar sesión"}
                  {!loading && (
                    <span
                      className="absolute inset-0 animate-shimmer"
                      style={{
                        background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)",
                      }}
                    />
                  )}
                </button>
              </div>

              <p className="text-center text-sm form-stagger-5" style={{ color: "var(--auth-muted)" }}>
                ¿No tienes cuenta?{" "}
                <button
                  type="button"
                  className="font-medium transition-colors hover:brightness-110"
                  style={{ color: "var(--auth-orange)" }}
                  onClick={() => setIsSignUp(true)}
                >
                  Crear cuenta
                </button>
              </p>
            </form>
          ) : (
            <form onSubmit={handleSignUp} className="space-y-4 sm:space-y-5">
              <div className="space-y-2 form-stagger-3">
                <Label className="text-sm font-medium" style={{ color: "var(--auth-text)" }}>Nombre completo</Label>
                <Input
                  id="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  maxLength={100}
                  className="h-12 transition-shadow duration-300"
                  style={inputStyle}
                  onFocus={(e) => { e.target.style.borderColor = "#F97316"; e.target.style.boxShadow = "0 0 0 4px rgba(249,115,22,0.15)"; }}
                  onBlur={(e) => { e.target.style.borderColor = "var(--auth-border)"; e.target.style.boxShadow = "none"; }}
                />
              </div>
              <div className="space-y-2 form-stagger-3">
                <Label className="text-sm font-medium" style={{ color: "var(--auth-text)" }}>Correo electrónico</Label>
                <Input
                  id="email2"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-12 transition-shadow duration-300"
                  style={inputStyle}
                  onFocus={(e) => { e.target.style.borderColor = "#F97316"; e.target.style.boxShadow = "0 0 0 4px rgba(249,115,22,0.15)"; }}
                  onBlur={(e) => { e.target.style.borderColor = "var(--auth-border)"; e.target.style.boxShadow = "none"; }}
                />
              </div>
              <div className="space-y-2 form-stagger-3">
                <Label className="text-sm font-medium" style={{ color: "var(--auth-text)" }}>Contraseña</Label>
                <Input
                  id="password2"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="h-12 transition-shadow duration-300"
                  style={inputStyle}
                  onFocus={(e) => { e.target.style.borderColor = "#F97316"; e.target.style.boxShadow = "0 0 0 4px rgba(249,115,22,0.15)"; }}
                  onBlur={(e) => { e.target.style.borderColor = "var(--auth-border)"; e.target.style.boxShadow = "none"; }}
                />
              </div>
              <div className="form-stagger-5">
                <button
                  type="submit"
                  disabled={loading}
                  className="relative h-12 w-full overflow-hidden rounded-[10px] text-base font-semibold text-white transition-all duration-200 hover:brightness-110 active:scale-[0.98]"
                  style={{ backgroundColor: "var(--auth-orange)" }}
                >
                  {loading ? "..." : "Crear cuenta"}
                  {!loading && (
                    <span
                      className="absolute inset-0 animate-shimmer"
                      style={{
                        background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)",
                      }}
                    />
                  )}
                </button>
              </div>

              <p className="text-center text-sm form-stagger-6" style={{ color: "var(--auth-muted)" }}>
                ¿Ya tienes cuenta?{" "}
                <button
                  type="button"
                  className="font-medium transition-colors hover:brightness-110"
                  style={{ color: "var(--auth-orange)" }}
                  onClick={() => setIsSignUp(false)}
                >
                  Iniciar sesión
                </button>
              </p>
            </form>
          )}
        </div>
      </div>

      {/* Bottom-right info */}
      <div className="pointer-events-none absolute bottom-0 right-0 hidden animate-fade-in p-8 lg:block" style={{ animationDelay: "1s" }}>
        <p className="text-sm leading-relaxed text-white/90 max-w-[280px] mb-6">
          Producción diaria, DJPMN, stock, consumos y asistencia en una sola herramienta de control para planta.
        </p>
        <div className="flex items-center justify-between gap-6">
          <span className="text-xs text-white/60">&copy; 2026 Lasarte Cítricos S.L.</span>
          <span className="text-xs text-white/60">Contacto &middot; Documentaci&oacute;n</span>
        </div>
      </div>
    </div>
  );
}
