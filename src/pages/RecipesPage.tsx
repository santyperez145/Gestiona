import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  ChefHat, Plus, Pencil, Trash2, Play, ChevronDown, ChevronRight,
  Clock, Package, DollarSign, Sparkles, Loader2,
} from "lucide-react";

interface Product { id: string; name: string; sku: string | null; price: number; }

interface Recipe {
  id: string;
  name: string;
  output_product_id: string | null;
  yield_qty: number;
  yield_unit: string;
  prep_time_min: number;
  cook_time_min: number;
  difficulty: string;
  category: string;
  instructions: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
}

interface RecipeIngredient {
  id: string;
  recipe_id: string;
  ingredient_product_id: string | null;
  ingredient_name: string;
  quantity: number;
  unit: string;
  unit_cost: number | null;
  is_optional: boolean;
  sort_order: number;
}

interface Production {
  id: string;
  recipe_id: string;
  batches: number;
  yield_qty: number;
  total_cost: number | null;
  notes: string | null;
  produced_at: string;
}

const DIFFICULTY = [
  { value: "easy", label: "Fácil", color: "text-emerald-400" },
  { value: "medium", label: "Media", color: "text-yellow-400" },
  { value: "hard", label: "Difícil", color: "text-destructive" },
];

const CATEGORIES = ["produccion", "alimentos", "cosmetica", "textil", "ensamblaje", "packaging", "otro"];
const UNITS = ["unidad", "kg", "g", "mg", "L", "mL", "m", "cm", "mm", "m2", "docena", "caja", "rollo"];

function fmtCurrency(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 }).format(n);
}

const EMPTY_RECIPE = {
  name: "", output_product_id: "", yield_qty: "1", yield_unit: "unidad",
  prep_time_min: "0", cook_time_min: "0", difficulty: "medium",
  category: "produccion", instructions: "", notes: "",
};

export default function RecipesPage() {
  usePageTitle("Fichas Técnicas & BOM");
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";

  const [products, setProducts] = useState<Product[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  const [productions, setProductions] = useState<Production[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("recipes");

  const [recipeOpen, setRecipeOpen] = useState(false);
  const [prodOpen, setProdOpen] = useState(false);
  const [expandedRecipe, setExpandedRecipe] = useState<string | null>(null);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);

  const [recipeForm, setRecipeForm] = useState(EMPTY_RECIPE);
  const [ingrRows, setIngrRows] = useState<{
    ingredient_product_id: string; ingredient_name: string; quantity: string; unit: string; unit_cost: string; is_optional: boolean;
  }[]>([{ ingredient_product_id: "", ingredient_name: "", quantity: "1", unit: "unidad", unit_cost: "", is_optional: false }]);
  const [prodForm, setProdForm] = useState({ batches: "1", notes: "" });

  async function loadData() {
    if (!orgId) return;
    setLoading(true);
    const [prodsRes, recipesRes, ingrRes, prodRes] = await Promise.all([
      supabase.from("products").select("id, name, sku, price").eq("org_id", orgId).order("name").limit(300),
      supabase.from("recipes").select("*").eq("org_id", orgId).eq("active", true).order("name"),
      supabase.from("recipe_ingredients").select("*").order("sort_order"),
      supabase.from("recipe_productions").select("*").eq("org_id", orgId).order("produced_at", { ascending: false }).limit(50),
    ]);
    setProducts((prodsRes.data || []) as Product[]);
    setRecipes((recipesRes.data || []) as Recipe[]);
    setIngredients((ingrRes.data || []) as RecipeIngredient[]);
    setProductions((prodRes.data || []) as Production[]);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [orgId]);

  function addIngrRow() {
    setIngrRows(rows => [...rows, { ingredient_product_id: "", ingredient_name: "", quantity: "1", unit: "unidad", unit_cost: "", is_optional: false }]);
  }
  function removeIngrRow(i: number) {
    setIngrRows(rows => rows.filter((_, idx) => idx !== i));
  }

  async function saveRecipe() {
    if (!recipeForm.name.trim()) { toast.error("Nombre requerido"); return; }
    const payload = {
      org_id: orgId, name: recipeForm.name.trim(),
      output_product_id: recipeForm.output_product_id || null,
      yield_qty: Number(recipeForm.yield_qty), yield_unit: recipeForm.yield_unit,
      prep_time_min: Number(recipeForm.prep_time_min), cook_time_min: Number(recipeForm.cook_time_min),
      difficulty: recipeForm.difficulty, category: recipeForm.category,
      instructions: recipeForm.instructions || null, notes: recipeForm.notes || null,
    };

    let recipeId = editingRecipe?.id;
    if (editingRecipe) {
      const { error } = await supabase.from("recipes").update(payload).eq("id", editingRecipe.id);
      if (error) { toast.error(error.message); return; }
      await supabase.from("recipe_ingredients").delete().eq("recipe_id", editingRecipe.id);
    } else {
      const { data, error } = await supabase.from("recipes").insert(payload).select("id").single();
      if (error) { toast.error(error.message); return; }
      recipeId = data.id;
    }

    // Insert ingredients
    const validIngredients = ingrRows
      .filter(r => r.ingredient_name.trim() || r.ingredient_product_id)
      .map((r, i) => {
        const prod = products.find(p => p.id === r.ingredient_product_id);
        return {
          recipe_id: recipeId!,
          ingredient_product_id: r.ingredient_product_id || null,
          ingredient_name: r.ingredient_name.trim() || prod?.name || "",
          quantity: Number(r.quantity) || 1,
          unit: r.unit,
          unit_cost: r.unit_cost ? Number(r.unit_cost) : (prod?.price ?? null),
          is_optional: r.is_optional,
          sort_order: i,
        };
      });
    if (validIngredients.length > 0) {
      await supabase.from("recipe_ingredients").insert(validIngredients);
    }

    toast.success(editingRecipe ? "Receta actualizada" : "Receta creada");
    setRecipeOpen(false); setEditingRecipe(null);
    setRecipeForm(EMPTY_RECIPE);
    setIngrRows([{ ingredient_product_id: "", ingredient_name: "", quantity: "1", unit: "unidad", unit_cost: "", is_optional: false }]);
    loadData();
  }

  async function deleteRecipe(id: string) {
    if (!confirm("¿Eliminar receta?")) return;
    await supabase.from("recipes").update({ active: false }).eq("id", id);
    toast.success("Receta eliminada");
    loadData();
  }

  async function recordProduction() {
    if (!selectedRecipe || !prodForm.batches) { toast.error("Ingresá la cantidad de tandas"); return; }
    const recipeIngrs = ingredients.filter(i => i.recipe_id === selectedRecipe.id);
    const batches = Number(prodForm.batches);
    const yieldQty = selectedRecipe.yield_qty * batches;
    const totalCost = recipeIngrs.reduce((s, i) => s + (i.unit_cost || 0) * i.quantity * batches, 0);

    const { error } = await supabase.from("recipe_productions").insert({
      org_id: orgId, recipe_id: selectedRecipe.id,
      batches, yield_qty: yieldQty, total_cost: totalCost || null,
      notes: prodForm.notes || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Producción registrada: ${yieldQty} ${selectedRecipe.yield_unit}`);
    setProdOpen(false); setSelectedRecipe(null);
    setProdForm({ batches: "1", notes: "" });
    loadData();
  }

  function openEdit(recipe: Recipe) {
    setEditingRecipe(recipe);
    setRecipeForm({
      name: recipe.name, output_product_id: recipe.output_product_id || "",
      yield_qty: String(recipe.yield_qty), yield_unit: recipe.yield_unit,
      prep_time_min: String(recipe.prep_time_min), cook_time_min: String(recipe.cook_time_min),
      difficulty: recipe.difficulty, category: recipe.category,
      instructions: recipe.instructions || "", notes: recipe.notes || "",
    });
    const recipeIngrs = ingredients.filter(i => i.recipe_id === recipe.id);
    if (recipeIngrs.length > 0) {
      setIngrRows(recipeIngrs.map(i => ({
        ingredient_product_id: i.ingredient_product_id || "",
        ingredient_name: i.ingredient_name,
        quantity: String(i.quantity), unit: i.unit,
        unit_cost: String(i.unit_cost ?? ""), is_optional: i.is_optional,
      })));
    }
    setRecipeOpen(true);
  }

  function calcRecipeCost(recipeId: string, batches = 1) {
    return ingredients.filter(i => i.recipe_id === recipeId)
      .reduce((s, i) => s + (i.unit_cost || 0) * i.quantity * batches, 0);
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-7 h-7 animate-spin text-primary" />
    </div>
  );

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={ChefHat}
        title="Fichas Técnicas & BOM"
        description="Recetas de producción con lista de ingredientes, costos y trazabilidad de lotes."
        actions={
          <Button onClick={() => { setEditingRecipe(null); setRecipeForm(EMPTY_RECIPE); setIngrRows([{ ingredient_product_id: "", ingredient_name: "", quantity: "1", unit: "unidad", unit_cost: "", is_optional: false }]); setRecipeOpen(true); }}>
            <Plus className="w-4 h-4 mr-1" /> Nueva receta
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <KPICard label="Total recetas" value={recipes.length} icon={ChefHat} color="primary" />
        <KPICard label="Producciones registradas" value={productions.length} icon={Play} color="success" />
        <KPICard
          label="Costo prom. por producción"
          value={productions.filter(p => p.total_cost).length > 0
            ? fmtCurrency(productions.filter(p => p.total_cost).reduce((s, p) => s + (p.total_cost || 0), 0) / productions.filter(p => p.total_cost).length)
            : "—"}
          icon={DollarSign}
          color="purple"
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="recipes">Recetas ({recipes.length})</TabsTrigger>
            <TabsTrigger value="productions">Producciones ({productions.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="recipes" className="pt-3 space-y-3">
            {recipes.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <ChefHat className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Sin recetas. Creá tu primera ficha técnica.</p>
              </div>
            ) : recipes.map(recipe => {
              const recipeIngrs = ingredients.filter(i => i.recipe_id === recipe.id);
              const cost = calcRecipeCost(recipe.id);
              const costPerUnit = recipe.yield_qty > 0 ? cost / recipe.yield_qty : 0;
              const outProd = products.find(p => p.id === recipe.output_product_id);
              const diff = DIFFICULTY.find(d => d.value === recipe.difficulty);
              const isExpanded = expandedRecipe === recipe.id;

              return (
                <div key={recipe.id} className="rounded-xl border border-border/50 bg-card overflow-hidden">
                  <div className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/20"
                    onClick={() => setExpandedRecipe(isExpanded ? null : recipe.id)}>
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{recipe.name}</span>
                        <span className={`text-xs ${diff?.color}`}>{diff?.label}</span>
                        <span className="text-xs bg-muted/40 px-2 py-0.5 rounded-full capitalize">{recipe.category.replace("_", " ")}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Rinde: {recipe.yield_qty} {recipe.yield_unit}
                        {outProd ? ` → ${outProd.name}` : ""}
                        {(recipe.prep_time_min + recipe.cook_time_min) > 0 && ` · ${recipe.prep_time_min + recipe.cook_time_min} min`}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-semibold text-sm">{cost > 0 ? fmtCurrency(cost) : "—"}</p>
                      {costPerUnit > 0 && <p className="text-xs text-muted-foreground">{fmtCurrency(costPerUnit)}/u.</p>}
                    </div>
                    <div className="flex gap-1 shrink-0 ml-1" onClick={e => e.stopPropagation()}>
                      <Button size="sm" className="h-7 text-xs" onClick={() => { setSelectedRecipe(recipe); setProdForm({ batches: "1", notes: "" }); setProdOpen(true); }}>
                        <Play className="w-3 h-3 mr-1" /> Producir
                      </Button>
                      <button onClick={() => openEdit(recipe)} className="p-1.5 text-muted-foreground hover:text-primary">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => deleteRecipe(recipe.id)} className="p-1.5 text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-border/30 px-4 py-3 space-y-3">
                      <p className="text-xs font-medium text-muted-foreground">Ingredientes / Materiales</p>
                      <div className="space-y-1 pb-12">
                        {recipeIngrs.map(ing => {
                          const prod = products.find(p => p.id === ing.ingredient_product_id);
                          return (
                            <div key={ing.id} className="flex items-center gap-3 text-xs">
                              <span className="flex-1">{ing.ingredient_name || prod?.name}
                                {ing.is_optional && <span className="ml-1 text-muted-foreground/50">(opcional)</span>}
                              </span>
                              <span className="text-muted-foreground">{ing.quantity} {ing.unit}</span>
                              <span className="font-mono">{ing.unit_cost ? fmtCurrency(ing.unit_cost * ing.quantity) : "—"}</span>
                            </div>
                          );
                        })}
                        {recipeIngrs.length === 0 && <p className="text-xs text-muted-foreground">Sin ingredientes cargados.</p>}
                      </div>
                      {recipe.instructions && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Instrucciones</p>
                          <p className="text-xs whitespace-pre-wrap">{recipe.instructions}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </TabsContent>

          <TabsContent value="productions" className="pt-3">
            {productions.length === 0 ? (
              <p className="text-center py-10 text-muted-foreground text-sm">Sin producciones registradas.</p>
            ) : (
              <div className="rounded-xl border border-border/50 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/20 border-b border-border/50">
                    <tr className="text-xs text-muted-foreground">
                      <th className="text-left px-3 py-2.5">Fecha</th>
                      <th className="text-left px-3 py-2.5">Receta</th>
                      <th className="text-right px-3 py-2.5">Tandas</th>
                      <th className="text-right px-3 py-2.5">Rendimiento</th>
                      <th className="text-right px-3 py-2.5">Costo total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productions.map(p => {
                      const r = recipes.find(r => r.id === p.recipe_id);
                      return (
                        <tr key={p.id} className="border-b border-border/30 hover:bg-muted/20">
                          <td className="px-3 py-2 text-muted-foreground text-xs">
                            {new Date(p.produced_at).toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}
                          </td>
                          <td className="px-3 py-2 font-medium">{r?.name || "—"}</td>
                          <td className="px-3 py-2 text-right">{p.batches}x</td>
                          <td className="px-3 py-2 text-right">{p.yield_qty} {r?.yield_unit}</td>
                          <td className="px-3 py-2 text-right font-mono">{p.total_cost ? fmtCurrency(p.total_cost) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
      </Tabs>

      {/* Recipe dialog */}
      <Dialog open={recipeOpen} onOpenChange={v => { setRecipeOpen(v); if (!v) setEditingRecipe(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingRecipe ? "Editar receta" : "Nueva receta / BOM"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nombre *</Label>
                <Input value={recipeForm.name} onChange={e => setRecipeForm(p => ({ ...p, name: e.target.value }))} placeholder="Torta de chocolate..." />
              </div>
              <div><Label>Producto resultante</Label>
                <Select value={recipeForm.output_product_id} onValueChange={v => setRecipeForm(p => ({ ...p, output_product_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="(ninguno)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Ninguno</SelectItem>
                    {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div><Label>Rendimiento</Label>
                <Input type="number" min="0.001" step="0.001" value={recipeForm.yield_qty}
                  onChange={e => setRecipeForm(p => ({ ...p, yield_qty: e.target.value }))} />
              </div>
              <div><Label>Unidad</Label>
                <Select value={recipeForm.yield_unit} onValueChange={v => setRecipeForm(p => ({ ...p, yield_unit: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Prep (min)</Label>
                <Input type="number" min="0" value={recipeForm.prep_time_min}
                  onChange={e => setRecipeForm(p => ({ ...p, prep_time_min: e.target.value }))} />
              </div>
              <div><Label>Cocción (min)</Label>
                <Input type="number" min="0" value={recipeForm.cook_time_min}
                  onChange={e => setRecipeForm(p => ({ ...p, cook_time_min: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Dificultad</Label>
                <Select value={recipeForm.difficulty} onValueChange={v => setRecipeForm(p => ({ ...p, difficulty: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{DIFFICULTY.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Categoría</Label>
                <Select value={recipeForm.category} onValueChange={v => setRecipeForm(p => ({ ...p, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.replace("_"," ")}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            {/* Ingredients grid */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Ingredientes / Materiales</Label>
                <Button size="sm" variant="outline" onClick={addIngrRow}><Plus className="w-3 h-3 mr-1" />Agregar</Button>
              </div>
              <div className="space-y-2 pb-12">
                {ingrRows.map((row, i) => (
                  <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
                    <div className="col-span-4">
                      <Select value={row.ingredient_product_id || "manual"}
                        onValueChange={v => {
                          const prod = products.find(p => p.id === v);
                          setIngrRows(rows => rows.map((r, idx) => idx === i
                            ? { ...r, ingredient_product_id: v === "manual" ? "" : v, ingredient_name: prod?.name || r.ingredient_name, unit_cost: prod ? String(prod.price) : r.unit_cost }
                            : r));
                        }}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Producto..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="manual">— Nombre manual —</SelectItem>
                          {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-3">
                      <Input className="h-8 text-xs" placeholder="Nombre ingrediente"
                        value={row.ingredient_name}
                        onChange={e => setIngrRows(rows => rows.map((r, idx) => idx === i ? { ...r, ingredient_name: e.target.value } : r))} />
                    </div>
                    <div className="col-span-1">
                      <Input className="h-8 text-xs" type="number" min="0" placeholder="Cant."
                        value={row.quantity}
                        onChange={e => setIngrRows(rows => rows.map((r, idx) => idx === i ? { ...r, quantity: e.target.value } : r))} />
                    </div>
                    <div className="col-span-2">
                      <Select value={row.unit} onValueChange={v => setIngrRows(rows => rows.map((r, idx) => idx === i ? { ...r, unit: v } : r))}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-1">
                      <Input className="h-8 text-xs" type="number" min="0" placeholder="$/u"
                        value={row.unit_cost}
                        onChange={e => setIngrRows(rows => rows.map((r, idx) => idx === i ? { ...r, unit_cost: e.target.value } : r))} />
                    </div>
                    <div className="col-span-1 flex justify-center">
                      <button onClick={() => removeIngrRow(i)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                {ingrRows.length > 0 && (
                  <div className="text-xs text-muted-foreground text-right pt-1">
                    Costo estimado: <strong>{fmtCurrency(ingrRows.reduce((s, r) => s + (Number(r.unit_cost) || 0) * (Number(r.quantity) || 0), 0))}</strong>
                  </div>
                )}
              </div>
            </div>

            <div><Label>Instrucciones</Label>
              <Textarea value={recipeForm.instructions}
                onChange={e => setRecipeForm(p => ({ ...p, instructions: e.target.value }))}
                placeholder="Pasos del proceso..." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRecipeOpen(false); setEditingRecipe(null); }}>Cancelar</Button>
            <Button onClick={saveRecipe}>{editingRecipe ? "Guardar" : "Crear receta"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Production dialog */}
      <Dialog open={prodOpen} onOpenChange={v => { setProdOpen(v); if (!v) setSelectedRecipe(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Registrar producción — {selectedRecipe?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {selectedRecipe && (
              <div className="rounded-lg bg-muted/30 p-3 text-xs space-y-1">
                <p>Rendimiento: <strong>{selectedRecipe.yield_qty * Number(prodForm.batches || 1)} {selectedRecipe.yield_unit}</strong></p>
                <p>Costo estimado: <strong>{fmtCurrency(calcRecipeCost(selectedRecipe.id, Number(prodForm.batches || 1)))}</strong></p>
              </div>
            )}
            <div><Label>Cantidad de tandas</Label>
              <Input type="number" min="0.5" step="0.5" value={prodForm.batches}
                onChange={e => setProdForm(p => ({ ...p, batches: e.target.value }))} autoFocus />
            </div>
            <div><Label>Notas</Label>
              <Input value={prodForm.notes} onChange={e => setProdForm(p => ({ ...p, notes: e.target.value }))} placeholder="Operario, lote..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProdOpen(false)}>Cancelar</Button>
            <Button onClick={recordProduction}><Sparkles className="w-4 h-4 mr-1" />Registrar producción</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
