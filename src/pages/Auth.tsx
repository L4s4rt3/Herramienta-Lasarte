import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthProvider";
import { Citrus, ShieldCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n";
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
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

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

  async function handleGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/` },
    });
  }

  return (
    <div className="grid min-h-screen bg-[var(--color-bg)] lg:grid-cols-[1fr_480px]">
      <section className="hidden border-r bg-sidebar p-10 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-[var(--glass-shadow-lg)]">
            <Citrus className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-semibold">{t("app_name")}</p>
            <p className="text-xs text-sidebar-foreground/55">Dashboard</p>
          </div>
        </div>

        <div className="max-w-xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-xl border border-sidebar-border bg-sidebar-accent/50 px-3 py-1 text-xs font-medium text-sidebar-foreground/80">
            <ShieldCheck className="h-3.5 w-3.5 text-sidebar-primary" />
            Acceso seguro
          </div>
          <h1 className="text-4xl font-semibold tracking-tight">
            Dashboard citrícola.
          </h1>
          <p className="mt-4 text-sm leading-6 text-sidebar-foreground/68">
            Producción diaria, DJPMN, stock, consumos y asistencia en una herramienta de control para planta.
          </p>
        </div>

        <p className="text-xs text-sidebar-foreground/45">Lasarte SAT</p>
      </section>

      <div className="flex min-h-screen items-center justify-center p-4 sm:p-8">
        <Card className="w-full max-w-md shadow-[var(--shadow-elegant)]">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[var(--shadow-elegant)] lg:hidden">
              <Citrus className="h-6 w-6" />
            </div>
            <CardTitle>{t("app_name")}</CardTitle>
            <CardDescription>Dashboard citrícola</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="signin">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">{t("login")}</TabsTrigger>
                <TabsTrigger value="signup">{t("signup")}</TabsTrigger>
              </TabsList>

              <TabsContent value="signin">
                <form onSubmit={handleSignIn} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">{t("email")}</Label>
                    <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">{t("password")}</Label>
                    <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                  </div>
                  <Button type="submit" className="w-full glass glass-hover" disabled={loading}>
                    {loading ? "..." : t("login")}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">{t("full_name")}</Label>
                    <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required maxLength={100} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email2">{t("email")}</Label>
                    <Input id="email2" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password2">{t("password")}</Label>
                    <Input id="password2" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
                  </div>
                  <Button type="submit" className="w-full glass glass-hover" disabled={loading}>
                    {loading ? "..." : t("signup")}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-[var(--glass-bg-strong)] px-2 text-muted-foreground backdrop-blur-sm">o</span>
              </div>
            </div>
            <Button variant="outline" className="glass glass-hover w-full" onClick={handleGoogle}>
              Continuar con Google
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
