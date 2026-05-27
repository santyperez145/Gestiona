import { useState } from "react";
import { useOrganization } from "@/hooks/useOrganization";
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
  Plus, Video, FileText, HelpCircle, ChevronRight, Zap, Trophy
} from "lucide-react";

interface Course {
  id: string;
  title: string;
  description: string;
  category: string;
  level: string;
  duration_min: number;
  is_mandatory: boolean;
  xp_reward: number;
  module_count: number;
  enrolled: number;
  completion_rate: number;
  avg_score: number;
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
  beginner:     "bg-green-100 text-green-700",
  intermediate: "bg-yellow-100 text-yellow-800",
  advanced:     "bg-red-100 text-red-700",
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

const MOCK_COURSES: Course[] = [
  {
    id: "c1", title: "Técnicas de Venta Avanzadas", description: "Metodologías SPIN, Challenger y consultiva para cerrar más ventas.",
    category: "sales", level: "intermediate", duration_min: 90, is_mandatory: false, xp_reward: 150,
    module_count: 6, enrolled: 12, completion_rate: 75, avg_score: 84, my_progress: 67, my_completed: false
  },
  {
    id: "c2", title: "Onboarding: Gestiona para Vendedores", description: "Todo lo que necesitás saber para empezar a usar el sistema.",
    category: "onboarding", level: "beginner", duration_min: 45, is_mandatory: true, xp_reward: 100,
    module_count: 4, enrolled: 18, completion_rate: 94, avg_score: 91, my_progress: 100, my_completed: true
  },
  {
    id: "c3", title: "Facturación AFIP y Cumplimiento Fiscal", description: "AFIP, CAE, tipos de comprobantes y obligaciones fiscales 2026.",
    category: "compliance", level: "intermediate", duration_min: 60, is_mandatory: true, xp_reward: 120,
    module_count: 5, enrolled: 15, completion_rate: 68, avg_score: 76, my_progress: 40, my_completed: false
  },
  {
    id: "c4", title: "Liderazgo de Equipos de Ventas", description: "Cómo liderar, motivar y medir performance de equipos comerciales.",
    category: "leadership", level: "advanced", duration_min: 120, is_mandatory: false, xp_reward: 200,
    module_count: 8, enrolled: 5, completion_rate: 45, avg_score: 88, my_progress: 0, my_completed: false
  },
  {
    id: "c5", title: "Gestión de Inventario y Stock", description: "Manejo de inventario, reposición y control de mermas.",
    category: "operations", level: "beginner", duration_min: 50, is_mandatory: false, xp_reward: 80,
    module_count: 4, enrolled: 9, completion_rate: 82, avg_score: 79, my_progress: 25, my_completed: false
  },
];

const MOCK_MODULES: Module[] = [
  { id: "m1", title: "Introducción a SPIN Selling", module_type: "video", duration_min: 15, completed: true },
  { id: "m2", title: "Las 4 preguntas SPIN en práctica", module_type: "video", duration_min: 20, completed: true },
  { id: "m3", title: "Lecturas recomendadas", module_type: "pdf", duration_min: 10, completed: false },
  { id: "m4", title: "Quiz: SPIN Selling", module_type: "quiz", duration_min: 8, completed: false },
  { id: "m5", title: "Metodología Challenger", module_type: "video", duration_min: 18, completed: false },
  { id: "m6", title: "Ejercicio de cierre", module_type: "exercise", duration_min: 15, completed: false },
];

const MODULE_ICONS: Record<string, typeof Video> = {
  video:    Video,
  text:     FileText,
  quiz:     HelpCircle,
  exercise: CheckCircle,
  pdf:      FileText,
  slide:    FileText,
};

export default function ELearningPage() {
  const { orgId } = useOrganization();
  const { user } = useAuth();
  const [tab, setTab] = useState<"catalog" | "mylearning" | "manage" | "reports">("catalog");
  const [courses] = useState<Course[]>(MOCK_COURSES);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [levelFilter, setLevelFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);

  const myCourses = courses.filter(c => c.my_progress > 0 || c.my_completed);
  const filtered = courses.filter(c =>
    (categoryFilter === "all" || c.category === categoryFilter) &&
    (levelFilter === "all" || c.level === levelFilter)
  );

  const totalXPEarned = courses.filter(c => c.my_completed).reduce((s, c) => s + c.xp_reward, 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="w-6 h-6 text-primary" /> Centro de Capacitación</h1>
          <p className="text-muted-foreground text-sm mt-1">Cursos, módulos y certificados para tu equipo</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-sm text-yellow-600 font-medium">
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
      </div>

      {/* My progress summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-primary">{myCourses.length}</p><p className="text-xs text-muted-foreground">Cursos iniciados</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-green-600">{courses.filter(c => c.my_completed).length}</p><p className="text-xs text-muted-foreground">Completados</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-yellow-600">{totalXPEarned}</p><p className="text-xs text-muted-foreground">XP ganados</p></CardContent></Card>
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
                        {course.is_mandatory && <Badge className="bg-red-100 text-red-700 border-0 text-xs">Obligatorio</Badge>}
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
                  {MOCK_MODULES.map((mod, i) => {
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
