import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { llamarIA } from "@/lib/ia";
import { getMarketingPostsDB, addMarketingPostDB, updateMarketingPostDB, deleteMarketingPostDB, getProductsDB } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToastContainer } from "@/components/ui/toast";
import { Link } from "react-router-dom";
import { useOrg } from "@/lib/orgContext";
import { usePersistedState } from "@/hooks/usePersistedState";
import { orgViewKey } from "@/hooks/usePersistedState";
import { toast } from "sonner";

export default function MarketingPage() {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  
  const [posts, setPosts] = useState([]);
  const [products, setProducts] = useState([]);
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = usePersistedState(
    orgViewKey("marketing.status-filter", activeOrg?.id),
    "all"
  );
  
  const [marketingParams] = useSearchParams();
  
  const [postTypes, setPostTypes] = useState([]);
  const [themes, setThemes] = useState([]);
  const [activeTab, setActiveTab] = usePersistedState<
    "posts" | "planner" | "images" | "calendar" | "templates" | "combos" | "automations" | "brand" | "ofertas"
  >(
    orgViewKey("marketing.tab", activeOrg?.id),
    "posts"
  );
  
  const [currentTab, setCurrentTab] = useState("posts");
  
  // Load marketing data
  useEffect(() => {
    loadMarketingData();
  }, []);
  
  const loadMarketingData = async () => {
    try {
      const [postsResult, productsResult] = await Promise.all([
        getMarketingPostsDB(user?.id),
        getProductsDB(user?.id)
      ]);
      setPosts(postsResult);
      setProducts(productsResult);
    } catch (error) {
      console.error("Failed to load marketing data:", error);
    }
  };
  
  const handleGenerateBrief = async (productName, objective, budgetARS, channel, influencerTier) => {
    if (!user) return;
    
    try {
      const response = await llamarIA({
        orgId: activeOrg?.id,
        productName,
        objective,
        budgetARS,
        channel,
        influencerTier
      });
      
      if (response && response.brief) {
        // Show generated brief in a modal or toast
        toast.success("Brief generado exitosamente!", "info");
        console.log("Generated brief:", response.brief);
      }
    } catch (error) {
      console.error("Failed to generate brief:", error);
      toast.error("Error generando brief", "error");
    }
  };
  
  const handleCreateCampaign = async (campaignData) => {
    if (!user) return;
    
    try {
      await addMarketingPostDB(campaignData);
      toast.success("Campaña creada exitosamente", "success");
    } catch (error) {
      console.error("Failed to create campaign:", error);
      toast.error("Error creando campaña", "error");
    }
  };
  
  const handleToggleTab = (tab) => {
    setCurrentTab(tab);
  };
  
  const handleCloseModal = () => {
    setOpen(false);
  };
  
  const renderTabContent = () => {
    switch (currentTab) {
      case "posts":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-bold mb-4">Publicaciones de Marketing</h2>
            {posts.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No hay publicaciones disponibles.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {posts.map(post => (
                  <div key={post.id} className="bg-white rounded-lg shadow p-4">
                    <h3 className="font-semibold">{post.title || post.name}</h3>
                    <p className="text-gray-600 mt-2">{post.description || post.body}</p>
                    <div className="mt-4">
                      <span className="inline-block px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded">{post.status}</span>
                      <span className="inline-block px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded">{post.type}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      
      case "planner":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-bold mb-4">Planificador de Campañas</h2>
            <p className="text-gray-600">Gestiona el ciclo de vida de tus campañas</p>
            <div className="bg-white rounded-lg shadow p-4">
              <p>Arrastra y solta elementos de campaña aquí</p>
            </div>
          </div>
        );
      
      case "templates":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-bold mb-4">Plantillas de Campañas</h2>
            <p className="text-gray-600">Plantillas reutilizables para campañas rápidas</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {themes.length > 0 && themes.map(theme => (
                <div key={theme.id} className="bg-white rounded-lg shadow p-4 border border-gray-200">
                  <h3 className="font-semibold text-lg">{theme.name}</h3>
                  <p className="text-gray-600">{theme.description}</p>
                </div>
              ))}
            </div>
          </div>
        );
      
      case "combos":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-bold mb-4">Combinaciones de Productos</h2>
            <p className="text-gray-600">Ideas de combos para aumentar conversiones</p>
            <div className="bg-white rounded-lg shadow p-4">
              <p>Selecciona productos complementarios para crear combos atractivos</p>
            </div>
          </div>
        );
      
      case "automations":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-bold mb-4">Flujos de Automatización</h2>
            <p className="text-gray-600">Automatiza procesos repetitivos</p>
            <div className="bg-white rounded-lg shadow p-4">
              <p>Configura flujos para notificaciones, tareas y reportes</p>
            </div>
          </div>
        );
      
      case "brand":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-bold mb-4">Identidad de Marca</h2>
            <p className="text-gray-600">Consistencia visual en todas tus campañas</p>
            <div className="bg-white rounded-lg shadow p-4">
              <p>Guías de estilo, logos y directrices visuales</p>
            </div>
          </div>
        );
      
      case "ofertas":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-bold mb-4">Ofertas y Promociones</h2>
            <p className="text-gray-600">Códigos y promociones temporales</p>
            <div className="bg-white rounded-lg shadow p-4">
              <p>Crea ofertas con descuentos y cupones</p>
            </div>
          </div>
        );
      
      default:
        return null;
    }
  };
  
  return (
    <div className="min-h-screen p-6">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Marketing</h1>
        <p className="text-gray-500 mt-2">Plataforma de Marketing</p>
      </header>
      
      <div className="max-w-7xl mx-auto">
        {/* Sidebar Navigation */}
        <aside className="w-64 space-y-3">
          <nav className="bg-white rounded-lg shadow p-4">
            <ul className="space-y-1">
              <li>
                <Link to="/" className="flex items-center p-2 hover:bg-gray-50 rounded">
                  <span className="font-medium">Marketing</span>
                </Link>
              </li>
              <li>
                <Link to="/campaigns" className="flex items-center p-2 hover:bg-gray-50 rounded">
                  <span className="font-medium">Campañas</span>
                </Link>
              </li>
              <li>
                <Link to="/templates" className="flex items-center p-2 hover:bg-gray-50 rounded">
                  <span className="font-medium">Plantillas</span>
                </Link>
              </li>
              <li>
                <Link to="/automations" className="flex items-center p-2 hover:bg-gray-50 rounded">
                  <span className="font-medium">Automatizaciones</span>
                </Link>
              </li>
              <li>
                <Link to="/branded" className="flex items-center p-2 hover:bg-gray-50 rounded">
                  <span className="font-medium">Marca</span>
                </Link>
              </li>
              <li>
                <Link to="/ofertas" className="flex items-center p-2 hover:bg-gray-50 rounded">
                  <span className="font-medium">Ofertas</span>
                </Link>
              </li>
            </ul>
          </nav>
        </aside>
        
        {/* Main Content */}
        <main className="ml-16">
          <div className="max-w-7xl mx-auto">
            {renderTabContent()}
          </div>
        </main>
      </div>
      
      <ToastContainer position="bottom-right" />
    </div>
  );
}