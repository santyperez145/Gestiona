import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  BookOpen, Play, CheckCircle, Clock, Star, Award, Users,
  Plus, Video, FileText, HelpCircle, ChevronRight, Zap, Trophy, Loader2,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";

interface Course {
  id: string;
  title: string;
  description: string | null;
  category: string;
  level: string;
  duration_min: number;
  is_mandatory: boolean;
  xp_reward: number;
  // stats from learning_course_stats view (may be null if no enrollments)
  module_count: number;
  enrolled: number;
  completion_rate: number;
  avg_score: number;
  // current user progress (from learning_enrollments)
  my_progress: number;
  my_completed: boolean;
}

interface Module {
  id: string;
  title: string;
  module_type: string;
  duration_min: number;
  completed: boolean;
}

const LEVEL_COLORS: Record<string, string> = {
  beginner:     "bg-emerald-500/15 text-emerald-400",
  intermediate: "bg-yellow-500/15 text-yellow-400",
  advanced:     "bg-red-500/15 text-red-400",
};

const CATEGORY_ICONS: Record<string, string> = {
  sales: "💰",
  products: "📦",
  compliance: "⚖️",
  operations: "⚙️",
  leadership: "🎯",
  onboarding: "🚀",
  general: "📚",
};


const MODULE_ICONS: Record<string, typeof Video> = {
  video:    Video,
  text:     FileText,
  quiz:     HelpCircle,
  exercise: CheckCircle,
  pdf:      FileText,
  slide:    FileText,
};

export default function ELearningPage() {
  usePageTitle("Centro de Capacitación");
  const { activeOrg } = useOrg();
  const { user } = useAuth();
  const [tab, setTab] = useState<"catalog" | "mylearning" | "manage" | "reports">("catalog");
  const [courses, setCourses] = useState<Course[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [levelFilter, setLevelFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    if (!activeOrg) return;
    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch courses with stats from the view
        const { data: statsData } = await supabase
          .from("learning_course_stats")
          .select("*")
          .eq("org_id", activeOrg.id);

        // Fetch base course data (mandatory, xp_reward, level, etc.)
        const { data: coursesData } = await supabase
          .from("learning_courses")
          .select("id, title, description, category, level, duration_min, is_mandatory, xp_reward")
          .eq("org_id", activeOrg.id)
          .eq("is_active", true)
          .order("created_at", { ascending: false });

        // Fetch current user enrollments for progress
        const { data: enrollments } = await supabase
          .from("learning_enrollments")
          .select("course_id, progress_pct, completed_at")
          .eq("org_id", activeOrg.id)
          .eq("user_id", user?.id ?? "");

        const enrollmentMap = new Map(
          (enrollments ?? []).map(e => [e.course_id, e])
        );
        const statsMap = new Map(
          (statsData ?? []).map((s: Record<string, unknown>) => [s.course_id as string, s])
        );

        const merged: Course[] = (coursesData ?? []).map(c => {
          const stats = statsMap.get(c.id) as Record<string, unknown> | undefined;
          const enr = enrollmentMap.get(c.id);
          return {
            id: c.id,
            title: c.title,
            description: c.description,
            category: c.category,
            level: c.level,
            duration_min: c.duration_min,
            is_mandatory: c.is_mandatory,
            xp_reward: c.xp_reward,
            module_count: stats ? Number(stats.module_count ?? 0) : 0,
            enrolled: stats ? Number(stats.total_enrolled ?? 0) : 0,
            completion_rate: stats ? Number(stats.completion_rate ?? 0) : 0,
            avg_score: stats ? Number(stats.avg_score ?? 0) : 0,
            my_progress: enr ? Number(enr.progress_pct ?? 0) : 0,
            my_completed: enr ? enr.completed_at !== null : false,
          };
        });
        setCourses(merged);

        // Fetch modules for the selected course (or first course as placeholder)
        if (merged.length > 0) {
          const firstId = merged[0].id;
          const { data: modsData } = await supabase
            .from("learning_modules")
            .select("id, title, module_type, duration_min")
            .eq("course_id", firstId)
            .order("sort_order", { ascending: true });
          setModules(
            (modsData ?? []).map(m => ({ ...m, completed: false }))
          );
        }
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [activeOrg, user?.id]);

  // Load modules when a course is selected
  useEffect(() => {
    if (!selectedCourse) return;
    supabase
      .from("learning_modules")
      .select("id, title, module_type, duration_min")
      .eq("course_id", selectedCourse.id)
      .order("sort_order", { ascending: true })
      .then(({ data }) => {
        setModules((data ?? []).map(m => ({ ...m, completed: false })));
      });
  }, [selectedCourse?.id]);

  const myCourses = courses.filter(c => c.my_progress > 0 || c.my_completed);
  const filtered = courses.filter(c =>
    (categoryFilter === "all" || c.category === categoryFilter) &&
    (levelFilter === "all" || c.level === levelFilter)
  );

  const totalXPEarned = courses.filter(c => c.my_completed).reduce((s, c) => s + c.xp_reward, 0);

  const kpis = useMemo(() => [
    { label: "Cursos disponibles", value: String(courses.length),                                sub: "en catálogo",      icon: BookOpen,   color: "primary"  as const },
    { label: "Cursos iniciados",   value: String(myCourses.length),                             sub: "en progreso",      icon: Play,       color: "blue"     as const },
    { label: "Completados",        value: String(courses.filter(c => c.my_completed).length),   sub: "con certificado",  icon: CheckCircle, color: "success" as const },
    { label: "XP ganados",         value: String(totalXPEarned),                                sub: "puntos de logro",  icon: Zap,        color: "warning"  as const },
  ], [courses, myCourses.length, totalXPEarned]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={BookOpen}
        title="Centro de Capacitación"
        description="Cursos, módulos y certificados para tu equipo"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-sm text-yellow-500 font-medium">
              <Zap className="w-4 h-4" />{totalXPEarned} XP ganados
            </div>
            <Dialog open={showCreate} onOpenChange={setShowCreate}>
              <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Crear Curso</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Nuevo Curso</DialogTitle></DialogHeader>
                <div className="space-y-4 py-2">
                  <div><Label>Título</Label><Input placeholder="Nombre del curso" /></div>
                  <div><Label>Descripción</Label><Input placeholder="¿Qué aprenderán?" /></div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label>Categoría</Label>
                      <Select defaultValue="general"><SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["sales","products","compliance","operations","leadership","onboarding","general"].map(c =>
                            <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label>Nivel</Label>
                      <Select defaultValue="beginner"><SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="beginner">Principiante</SelectItem>
                          <SelectItem value="intermediate">Intermedio</SelectItem>
                          <SelectItem value="advanced">Avanzado</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label>Duración (min)</Label><Input type="number" defaultValue={60} /></div>
                    <div><Label>XP de recompensa</Label><Input type="number" defaultValue={100} /></div>
                  </div>
                  <Button className="w-full" onClick={() => { toast.success("Curso creado"); setShowCreate(false); }}>Crear Curso</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map(k => (
          <KPICard key={k.label} label={k.label} value={k.value} sub={k.sub} icon={k.icon} color={k.color} />
        ))}
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="catalog">Catálogo</TabsTrigger>
          <TabsTrigger value="mylearning">Mi Aprendizaje</TabsTrigger>
          <TabsTrigger value="manage">Gestionar</TabsTrigger>
          <TabsTrigger value="reports">Reportes</TabsTrigger>
        </TabsList>

        {/* CATALOG */}
        <TabsContent value="catalog" className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Categoría" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {Object.keys(CATEGORY_ICONS).map(c => <SelectItem key={c} value={c} className="capitalize">{CATEGORY_ICONS[c]} {c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Nivel" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="beginner">Principiante</SelectItem>
                <SelectItem value="intermediate">Intermedio</SelectItem>
                <SelectItem value="advanced">Avanzado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map(course => (
              <Card key={course.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelectedCourse(course)}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{CATEGORY_ICONS[course.category]}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{course.title}</span>
                        {course.is_mandatory && <Badge className="bg-red-500/15 text-red-400 border-0 text-xs">Obligatorio</Badge>}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${LEVEL_COLORS[course.level]}`}>{course.level}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{course.description}</p>
                      <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{course.duration_min}min</span>
                        <span className="flex items-center gap-1"><BookOpen className="w-3 h-3" />{course.module_count} módulos</span>
                        <span className="flex items-center gap-1"><Users className="w-3 h-3" />{course.enrolled}</span>
                        <span className="flex items-center gap-1"><Zap className="w-3 h-3 text-yellow-500" />+{course.xp_reward} XP</span>
                      </div>
                    </div>
                  </div>
                  {course.my_progress > 0 && (
                    <div className="mt-3">
                      <div className="flex justify-between text-xs mb-1">
                        <span>{course.my_completed ? "✓ Completado" : `${course.my_progress}% completado`}</span>
                        {course.my_completed && <span className="text-green-600 font-medium">+{course.xp_reward} XP</span>}
                      </div>
                      <Progress value={course.my_progress} className="h-2" />
                    </div>
                  )}
                  {course.my_progress === 0 && (
                    <Button size="sm" className="mt-3 w-full" onClick={e => { e.stopPropagation(); toast.success("¡Inscripto al curso!"); }}>
                      <Play className="w-3 h-3 mr-1" />Iniciar Curso
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* MY LEARNING */}
        <TabsContent value="mylearning" className="space-y-4">
          {myCourses.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Todavía no iniciaste ningún curso</p>
              <Button className="mt-4" onClick={() => setTab("catalog")}>Ver Catálogo</Button>
            </div>
          ) : (
            myCourses.map(course => (
              <Card key={course.id}>
                <CardContent className="p-4 flex items-center gap-4">
                  <span className="text-2xl">{CATEGORY_ICONS[course.category]}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{course.title}</span>
                      {course.my_completed && <CheckCircle className="w-4 h-4 text-green-500" />}
                    </div>
                    <div className="mt-2">
                      <div className="flex justify-between text-xs mb-1">
                        <span>{course.my_completed ? "Completado" : `${course.my_progress}% completado`}</span>
                        <span className="text-muted-foreground">{course.module_count} módulos</span>
                      </div>
                      <Progress value={course.my_progress} className="h-2" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {course.my_completed
                      ? <Button size="sm" variant="outline" onClick={() => toast.info("Descargando certificado...")}><Award className="w-3 h-3 mr-1" />Certificado</Button>
                      : <Button size="sm" onClick={() => setSelectedCourse(course)}><Play className="w-3 h-3 mr-1" />Continuar</Button>}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* MANAGE */}
        <TabsContent value="manage" className="space-y-3">
          {courses.map(course => (
            <Card key={course.id}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="flex-1">
                  <span className="font-semibold">{course.title}</span>
                  <div className="flex gap-3 text-xs text-muted-foreground mt-1">
                    <span>{course.enrolled} inscriptos</span>
                    <span>{course.completion_rate}% completado</span>
                    <span>Score prom.: {course.avg_score}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => toast.info("Editando curso...")}>Editar</Button>
                  <Button size="sm" variant="outline" onClick={() => toast.info("Inscribiendo equipo...")}>Asignar</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* REPORTS */}
        <TabsContent value="reports">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 border-b">
                  <tr>
                    <th className="text-left py-3 px-4">Curso</th>
                    <th className="text-right py-3 px-4">Inscriptos</th>
                    <th className="text-right py-3 px-4">Completados</th>
                    <th className="text-right py-3 px-4">Tasa</th>
                    <th className="text-right py-3 px-4">Score Prom.</th>
                    <th className="py-3 px-4">Progreso</th>
                  </tr>
                </thead>
                <tbody>
                  {courses.map(c => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-3 px-4 font-medium">{c.title}</td>
                      <td className="py-3 px-4 text-right">{c.enrolled}</td>
                      <td className="py-3 px-4 text-right">{Math.round(c.enrolled * c.completion_rate / 100)}</td>
                      <td className="py-3 px-4 text-right">{c.completion_rate}%</td>
                      <td className="py-3 px-4 text-right">{c.avg_score}</td>
                      <td className="py-3 px-4 w-32"><Progress value={c.completion_rate} className="h-2" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Course detail modal */}
      {selectedCourse && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setSelectedCourse(null)}>
          <Card className="w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">{selectedCourse.title}</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">{selectedCourse.description}</p>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setSelectedCourse(null)}>✕</Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3 text-sm">
                <span className="flex items-center gap-1"><Clock className="w-4 h-4" />{selectedCourse.duration_min}min</span>
                <span className="flex items-center gap-1"><Zap className="w-4 h-4 text-yellow-500" />+{selectedCourse.xp_reward} XP</span>
                <span className="flex items-center gap-1"><Star className="w-4 h-4 text-yellow-500" />{selectedCourse.avg_score}/100</span>
              </div>
              <div>
                <p className="text-sm font-semibold mb-2">Módulos del curso</p>
                <div className="space-y-2">
                  {modules.map((mod, i) => {
                    const Icon = MODULE_ICONS[mod.module_type] ?? FileText;
                    return (
                      <div key={mod.id} className={`flex items-center gap-3 p-2 rounded-lg ${mod.completed ? "bg-green-50" : "bg-muted/30"}`}>
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${mod.completed ? "bg-green-500 text-white" : "bg-muted-foreground/20"}`}>
                          {mod.completed ? "✓" : i + 1}
                        </div>
                        <Icon className="w-4 h-4 text-muted-foreground" />
                        <span className="flex-1 text-sm">{mod.title}</span>
                        <span className="text-xs text-muted-foreground">{mod.duration_min}min</span>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    );
                  })}
                </div>
              </div>
              <Button className="w-full" onClick={() => { toast.success("¡Continuando curso!"); setSelectedCourse(null); }}>
                <Play className="w-4 h-4 mr-2" />
                {selectedCourse.my_progress > 0 ? "Continuar" : "Iniciar"} Curso
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
