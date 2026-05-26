import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Car, Plus, Wrench, Fuel, MapPin, AlertTriangle,
  CheckCircle, Clock, ChevronDown, ChevronRight, DollarSign
} from "lucide-react";

interface Vehicle {
  id: string;
  name: string;
  plate: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  fuel_type: string;
  status: string;
  odometer_km: number;
  insurance_expiry: string | null;
  vtv_expiry: string | null;
  assigned_to_name: string | null;
  notes: string | null;
  active: boolean;
}

interface Maintenance {
  id: string;
  vehicle_id: string;
  maintenance_type: string;
  title: string;
  description: string | null;
  scheduled_date: string | null;
  completed_date: string | null;
  cost: number;
  provider_name: string | null;
  status: string;
  notes: string | null;
  vehicles?: { name: string; plate: string | null } | null;
}

interface FuelLog {
  id: string;
  vehicle_id: string;
  date: string;
  liters: number;
  price_per_liter: number;
  total_cost: number;
  odometer_km: number | null;
  station_name: string | null;
  vehicles?: { name: string } | null;
}

interface Trip {
  id: string;
  vehicle_id: string;
  driver_name: string;
  purpose: string | null;
  origin: string | null;
  destination: string | null;
  start_odometer: number | null;
  end_odometer: number | null;
  km_driven: number | null;
  start_time: string;
  end_time: string | null;
  vehicles?: { name: string } | null;
}

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  available:   { label: "Disponible",   color: "bg-green-100 text-green-800" },
  in_use:      { label: "En uso",       color: "bg-blue-100 text-blue-800" },
  maintenance: { label: "Mantenimiento",color: "bg-orange-100 text-orange-800" },
  inactive:    { label: "Inactivo",     color: "bg-gray-100 text-gray-600" },
};

const FUEL_LABELS: Record<string, string> = {
  nafta: "Nafta", diesel: "Diesel", gnc: "GNC",
  electrico: "Eléctrico", hibrido: "Híbrido", otro: "Otro"
};

const MAINT_STATUS_CFG: Record<string, { label: string; color: string }> = {
  scheduled:   { label: "Programado",   color: "bg-yellow-100 text-yellow-800" },
  in_progress: { label: "En progreso",  color: "bg-blue-100 text-blue-800" },
  completed:   { label: "Completado",   color: "bg-green-100 text-green-800" },
  cancelled:   { label: "Cancelado",    color: "bg-gray-100 text-gray-600" },
};

const EMPTY_VEHICLE = {
  name: "", plate: "", brand: "", model: "", year: new Date().getFullYear(),
  fuel_type: "nafta", status: "available", odometer_km: 0,
  insurance_expiry: "", vtv_expiry: "", assigned_to_name: "", notes: ""
};

const EMPTY_MAINT = {
  vehicle_id: "", maintenance_type: "service", title: "", description: "",
  scheduled_date: "", cost: 0, provider_name: "", status: "scheduled", notes: ""
};

const EMPTY_FUEL = {
  vehicle_id: "", date: new Date().toISOString().split("T")[0],
  liters: 0, price_per_liter: 0, odometer_km: 0, station_name: "", notes: ""
};

const EMPTY_TRIP = {
  vehicle_id: "", driver_name: "", purpose: "", origin: "",
  destination: "", start_odometer: 0, end_odometer: 0, notes: ""
};

export default function FleetPage() {
  const { orgId } = useAuth();

  const [vehicles, setVehicles]     = useState<Vehicle[]>([]);
  const [maintenance, setMaintenance] = useState<Maintenance[]>([]);
  const [fuelLogs, setFuelLogs]     = useState<FuelLog[]>([]);
  const [trips, setTrips]           = useState<Trip[]>([]);
  const [loading, setLoading]       = useState(true);
  const [activeTab, setActiveTab]   = useState("vehicles");
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);
  const [expandedMaint, setExpandedMaint] = useState<string | null>(null);

  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [vehicleForm, setVehicleForm] = useState({ ...EMPTY_VEHICLE });
  const [savingVehicle, setSavingVehicle] = useState(false);

  const [maintOpen, setMaintOpen] = useState(false);
  const [maintForm, setMaintForm] = useState({ ...EMPTY_MAINT });
  const [savingMaint, setSavingMaint] = useState(false);

  const [fuelOpen, setFuelOpen] = useState(false);
  const [fuelForm, setFuelForm] = useState({ ...EMPTY_FUEL });
  const [savingFuel, setSavingFuel] = useState(false);

  const [tripOpen, setTripOpen] = useState(false);
  const [tripForm, setTripForm] = useState({ ...EMPTY_TRIP });
  const [savingTrip, setSavingTrip] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [vRes, mRes, fRes, tRes] = await Promise.allSettled([
      supabase.from("vehicles").select("*").eq("org_id", orgId).eq("active", true).order("name"),
      supabase.from("vehicle_maintenance").select("*, vehicles(name, plate)").eq("org_id", orgId).order("scheduled_date", { ascending: false }),
      supabase.from("vehicle_fuel_logs").select("*, vehicles(name)").eq("org_id", orgId).order("date", { ascending: false }),
      supabase.from("vehicle_trips").select("*, vehicles(name)").eq("org_id", orgId).order("start_time", { ascending: false }),
    ]);
    if (vRes.status === "fulfilled" && vRes.value.data) setVehicles(vRes.value.data as Vehicle[]);
    if (mRes.status === "fulfilled" && mRes.value.data) setMaintenance(mRes.value.data as Maintenance[]);
    if (fRes.status === "fulfilled" && fRes.value.data) setFuelLogs(fRes.value.data as FuelLog[]);
    if (tRes.status === "fulfilled" && tRes.value.data) setTrips(tRes.value.data as Trip[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  async function saveVehicle() {
    if (!orgId || !vehicleForm.name.trim()) return toast.error("Ingresá el nombre del vehículo");
    setSavingVehicle(true);
    const { error } = await supabase.from("vehicles").insert({
      org_id: orgId,
      name: vehicleForm.name.trim(),
      plate: vehicleForm.plate || null,
      brand: vehicleForm.brand || null,
      model: vehicleForm.model || null,
      year: Number(vehicleForm.year) || null,
      fuel_type: vehicleForm.fuel_type,
      status: vehicleForm.status,
      odometer_km: Number(vehicleForm.odometer_km),
      insurance_expiry: vehicleForm.insurance_expiry || null,
      vtv_expiry: vehicleForm.vtv_expiry || null,
      assigned_to_name: vehicleForm.assigned_to_name || null,
      notes: vehicleForm.notes || null,
    });
    setSavingVehicle(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Vehículo agregado");
    setVehicleOpen(false);
    setVehicleForm({ ...EMPTY_VEHICLE });
    load();
  }

  async function saveMaintenance() {
    if (!orgId || !maintForm.vehicle_id) return toast.error("Seleccioná un vehículo");
    if (!maintForm.title.trim()) return toast.error("Ingresá el título del mantenimiento");
    setSavingMaint(true);
    const { error } = await supabase.from("vehicle_maintenance").insert({
      org_id: orgId,
      vehicle_id: maintForm.vehicle_id,
      maintenance_type: maintForm.maintenance_type,
      title: maintForm.title.trim(),
      description: maintForm.description || null,
      scheduled_date: maintForm.scheduled_date || null,
      cost: Number(maintForm.cost),
      provider_name: maintForm.provider_name || null,
      status: maintForm.status,
      notes: maintForm.notes || null,
    });
    setSavingMaint(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Mantenimiento registrado");
    setMaintOpen(false);
    setMaintForm({ ...EMPTY_MAINT });
    load();
  }

  async function completeMaintenance(id: string) {
    const { error } = await supabase.from("vehicle_maintenance").update({
      status: "completed", completed_date: new Date().toISOString().split("T")[0]
    }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Mantenimiento completado");
    load();
  }

  async function saveFuel() {
    if (!orgId || !fuelForm.vehicle_id) return toast.error("Seleccioná un vehículo");
    if (Number(fuelForm.liters) <= 0) return toast.error("Ingresá los litros cargados");
    setSavingFuel(true);
    const { error } = await supabase.from("vehicle_fuel_logs").insert({
      org_id: orgId,
      vehicle_id: fuelForm.vehicle_id,
      date: fuelForm.date,
      liters: Number(fuelForm.liters),
      price_per_liter: Number(fuelForm.price_per_liter),
      odometer_km: Number(fuelForm.odometer_km) || null,
      station_name: fuelForm.station_name || null,
      fuel_type: vehicles.find(v => v.id === fuelForm.vehicle_id)?.fuel_type ?? "nafta",
      notes: fuelForm.notes || null,
    });
    setSavingFuel(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Carga de combustible registrada");
    setFuelOpen(false);
    setFuelForm({ ...EMPTY_FUEL });
    load();
  }

  async function saveTrip() {
    if (!orgId || !tripForm.vehicle_id) return toast.error("Seleccioná un vehículo");
    if (!tripForm.driver_name.trim()) return toast.error("Ingresá el nombre del conductor");
    setSavingTrip(true);
    const { error } = await supabase.from("vehicle_trips").insert({
      org_id: orgId,
      vehicle_id: tripForm.vehicle_id,
      driver_name: tripForm.driver_name.trim(),
      purpose: tripForm.purpose || null,
      origin: tripForm.origin || null,
      destination: tripForm.destination || null,
      start_odometer: Number(tripForm.start_odometer) || null,
      end_odometer: Number(tripForm.end_odometer) || null,
    });
    setSavingTrip(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Viaje registrado");
    setTripOpen(false);
    setTripForm({ ...EMPTY_TRIP });
    load();
  }

  const fmt = (n: number) => `$${Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;

  const isExpiringSoon = (dateStr: string | null) => {
    if (!dateStr) return false;
    const days = (new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return days <= 30;
  };

  const isExpired = (dateStr: string | null) => {
    if (!dateStr) return false;
    return new Date(dateStr) < new Date();
  };

  const totalFuelCost = fuelLogs.reduce((s, f) => s + Number(f.total_cost), 0);
  const totalMaintCost = maintenance.reduce((s, m) => s + Number(m.cost), 0);
  const pendingMaint = maintenance.filter(m => m.status === "scheduled").length;
  const totalKm = trips.reduce((s, t) => s + Number(t.km_driven ?? 0), 0);

  const filteredMaint = selectedVehicle ? maintenance.filter(m => m.vehicle_id === selectedVehicle) : maintenance;
  const filteredFuel = selectedVehicle ? fuelLogs.filter(f => f.vehicle_id === selectedVehicle) : fuelLogs;
  const filteredTrips = selectedVehicle ? trips.filter(t => t.vehicle_id === selectedVehicle) : trips;

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Car className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Flota Vehicular</h1>
            <p className="text-sm text-gray-500">Vehículos, mantenimiento, combustible y viajes</p>
          </div>
        </div>
        <div className="flex gap-2">
          {activeTab === "vehicles" && (
            <Dialog open={vehicleOpen} onOpenChange={setVehicleOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => setVehicleForm({ ...EMPTY_VEHICLE })}>
                  <Plus className="w-4 h-4 mr-2" /> Agregar vehículo
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>Nuevo vehículo</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label>Nombre *</Label>
                    <Input value={vehicleForm.name} onChange={e => setVehicleForm(f => ({ ...f, name: e.target.value }))} placeholder="Ej: Camioneta Ranger - Reparto Norte" />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label>Patente</Label>
                      <Input value={vehicleForm.plate} onChange={e => setVehicleForm(f => ({ ...f, plate: e.target.value.toUpperCase() }))} placeholder="AA123BB" />
                    </div>
                    <div className="space-y-1">
                      <Label>Marca</Label>
                      <Input value={vehicleForm.brand} onChange={e => setVehicleForm(f => ({ ...f, brand: e.target.value }))} placeholder="Ford" />
                    </div>
                    <div className="space-y-1">
                      <Label>Modelo</Label>
                      <Input value={vehicleForm.model} onChange={e => setVehicleForm(f => ({ ...f, model: e.target.value }))} placeholder="Ranger" />
                    </div>
                    <div className="space-y-1">
                      <Label>Año</Label>
                      <Input type="number" value={vehicleForm.year} onChange={e => setVehicleForm(f => ({ ...f, year: Number(e.target.value) }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Combustible</Label>
                      <Select value={vehicleForm.fuel_type} onValueChange={v => setVehicleForm(f => ({ ...f, fuel_type: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(FUEL_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Odómetro (km)</Label>
                      <Input type="number" value={vehicleForm.odometer_km} onChange={e => setVehicleForm(f => ({ ...f, odometer_km: Number(e.target.value) }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Venc. seguro</Label>
                      <Input type="date" value={vehicleForm.insurance_expiry} onChange={e => setVehicleForm(f => ({ ...f, insurance_expiry: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Venc. VTV</Label>
                      <Input type="date" value={vehicleForm.vtv_expiry} onChange={e => setVehicleForm(f => ({ ...f, vtv_expiry: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Responsable asignado</Label>
                    <Input value={vehicleForm.assigned_to_name} onChange={e => setVehicleForm(f => ({ ...f, assigned_to_name: e.target.value }))} placeholder="Nombre del conductor/encargado" />
                  </div>
                  <div className="space-y-1">
                    <Label>Notas</Label>
                    <Textarea value={vehicleForm.notes} onChange={e => setVehicleForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
                  </div>
                  <Button className="w-full" onClick={saveVehicle} disabled={savingVehicle}>
                    {savingVehicle ? "Guardando..." : "Agregar vehículo"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
          {activeTab === "maintenance" && (
            <Dialog open={maintOpen} onOpenChange={setMaintOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => setMaintForm({ ...EMPTY_MAINT })}>
                  <Plus className="w-4 h-4 mr-2" /> Nuevo mantenimiento
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>Registrar mantenimiento</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label>Vehículo *</Label>
                    <Select value={maintForm.vehicle_id} onValueChange={v => setMaintForm(f => ({ ...f, vehicle_id: v }))}>
                      <SelectTrigger><SelectValue placeholder="Seleccionar vehículo" /></SelectTrigger>
                      <SelectContent>
                        {vehicles.map(v => <SelectItem key={v.id} value={v.id}>{v.name} {v.plate && `(${v.plate})`}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Tipo</Label>
                      <Select value={maintForm.maintenance_type} onValueChange={v => setMaintForm(f => ({ ...f, maintenance_type: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="service">Service</SelectItem>
                          <SelectItem value="tire">Neumáticos</SelectItem>
                          <SelectItem value="brake">Frenos</SelectItem>
                          <SelectItem value="oil">Aceite</SelectItem>
                          <SelectItem value="filter">Filtros</SelectItem>
                          <SelectItem value="battery">Batería</SelectItem>
                          <SelectItem value="bodywork">Carrocería</SelectItem>
                          <SelectItem value="inspection">Inspección</SelectItem>
                          <SelectItem value="other">Otro</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Estado</Label>
                      <Select value={maintForm.status} onValueChange={v => setMaintForm(f => ({ ...f, status: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="scheduled">Programado</SelectItem>
                          <SelectItem value="in_progress">En progreso</SelectItem>
                          <SelectItem value="completed">Completado</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Título *</Label>
                    <Input value={maintForm.title} onChange={e => setMaintForm(f => ({ ...f, title: e.target.value }))} placeholder="Service 10.000 km" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Fecha programada</Label>
                      <Input type="date" value={maintForm.scheduled_date} onChange={e => setMaintForm(f => ({ ...f, scheduled_date: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Costo</Label>
                      <Input type="number" min={0} value={maintForm.cost} onChange={e => setMaintForm(f => ({ ...f, cost: Number(e.target.value) }))} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Proveedor / Taller</Label>
                    <Input value={maintForm.provider_name} onChange={e => setMaintForm(f => ({ ...f, provider_name: e.target.value }))} placeholder="Taller Central..." />
                  </div>
                  <div className="space-y-1">
                    <Label>Descripción</Label>
                    <Textarea value={maintForm.description} onChange={e => setMaintForm(f => ({ ...f, description: e.target.value }))} rows={2} />
                  </div>
                  <Button className="w-full" onClick={saveMaintenance} disabled={savingMaint}>
                    {savingMaint ? "Guardando..." : "Registrar"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
          {activeTab === "fuel" && (
            <Dialog open={fuelOpen} onOpenChange={setFuelOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => setFuelOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" /> Carga combustible
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>Registrar carga de combustible</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label>Vehículo *</Label>
                    <Select value={fuelForm.vehicle_id} onValueChange={v => setFuelForm(f => ({ ...f, vehicle_id: v }))}>
                      <SelectTrigger><SelectValue placeholder="Seleccionar vehículo" /></SelectTrigger>
                      <SelectContent>
                        {vehicles.map(v => <SelectItem key={v.id} value={v.id}>{v.name} {v.plate && `(${v.plate})`}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Fecha</Label>
                      <Input type="date" value={fuelForm.date} onChange={e => setFuelForm(f => ({ ...f, date: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Litros *</Label>
                      <Input type="number" min={0} step={0.01} value={fuelForm.liters} onChange={e => setFuelForm(f => ({ ...f, liters: Number(e.target.value) }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Precio x litro</Label>
                      <Input type="number" min={0} step={0.01} value={fuelForm.price_per_liter} onChange={e => setFuelForm(f => ({ ...f, price_per_liter: Number(e.target.value) }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Odómetro (km)</Label>
                      <Input type="number" min={0} value={fuelForm.odometer_km} onChange={e => setFuelForm(f => ({ ...f, odometer_km: Number(e.target.value) }))} />
                    </div>
                  </div>
                  {fuelForm.liters > 0 && fuelForm.price_per_liter > 0 && (
                    <div className="bg-blue-50 rounded p-2 text-sm text-blue-800 font-medium">
                      Total: {fmt(Number(fuelForm.liters) * Number(fuelForm.price_per_liter))}
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label>Estación</Label>
                    <Input value={fuelForm.station_name} onChange={e => setFuelForm(f => ({ ...f, station_name: e.target.value }))} placeholder="YPF, Shell, Axion..." />
                  </div>
                  <Button className="w-full" onClick={saveFuel} disabled={savingFuel}>
                    {savingFuel ? "Guardando..." : "Registrar"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
          {activeTab === "trips" && (
            <Dialog open={tripOpen} onOpenChange={setTripOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => setTripForm({ ...EMPTY_TRIP })}>
                  <Plus className="w-4 h-4 mr-2" /> Nuevo viaje
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>Registrar viaje</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label>Vehículo *</Label>
                    <Select value={tripForm.vehicle_id} onValueChange={v => setTripForm(f => ({ ...f, vehicle_id: v }))}>
                      <SelectTrigger><SelectValue placeholder="Seleccionar vehículo" /></SelectTrigger>
                      <SelectContent>
                        {vehicles.map(v => <SelectItem key={v.id} value={v.id}>{v.name} {v.plate && `(${v.plate})`}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Conductor *</Label>
                    <Input value={tripForm.driver_name} onChange={e => setTripForm(f => ({ ...f, driver_name: e.target.value }))} placeholder="Nombre del conductor" />
                  </div>
                  <div className="space-y-1">
                    <Label>Propósito</Label>
                    <Input value={tripForm.purpose} onChange={e => setTripForm(f => ({ ...f, purpose: e.target.value }))} placeholder="Entrega, visita cliente..." />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Origen</Label>
                      <Input value={tripForm.origin} onChange={e => setTripForm(f => ({ ...f, origin: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Destino</Label>
                      <Input value={tripForm.destination} onChange={e => setTripForm(f => ({ ...f, destination: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Km inicio</Label>
                      <Input type="number" value={tripForm.start_odometer} onChange={e => setTripForm(f => ({ ...f, start_odometer: Number(e.target.value) }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Km fin</Label>
                      <Input type="number" value={tripForm.end_odometer} onChange={e => setTripForm(f => ({ ...f, end_odometer: Number(e.target.value) }))} />
                    </div>
                  </div>
                  {Number(tripForm.end_odometer) > Number(tripForm.start_odometer) && (
                    <div className="bg-green-50 rounded p-2 text-sm text-green-800">
                      Distancia: {Number(tripForm.end_odometer) - Number(tripForm.start_odometer)} km
                    </div>
                  )}
                  <Button className="w-full" onClick={saveTrip} disabled={savingTrip}>
                    {savingTrip ? "Guardando..." : "Registrar viaje"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Vehículos activos</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{vehicles.length}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-1"><AlertTriangle className="w-4 h-4 text-orange-500" /><p className="text-xs text-gray-500 uppercase tracking-wide">Mant. pendientes</p></div>
          <p className="text-3xl font-bold text-orange-600">{pendingMaint}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-1"><Fuel className="w-4 h-4 text-blue-500" /><p className="text-xs text-gray-500 uppercase tracking-wide">Costo combustible</p></div>
          <p className="text-3xl font-bold text-blue-600">{fmt(totalFuelCost)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-1"><MapPin className="w-4 h-4 text-green-500" /><p className="text-xs text-gray-500 uppercase tracking-wide">Km recorridos</p></div>
          <p className="text-3xl font-bold text-green-600">{totalKm.toLocaleString("es-AR")}</p>
        </CardContent></Card>
      </div>

      {/* Vehicle filter pills */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setSelectedVehicle(null)}
          className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${!selectedVehicle ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"}`}>
          Todos
        </button>
        {vehicles.map(v => (
          <button key={v.id} onClick={() => setSelectedVehicle(v.id)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${selectedVehicle === v.id ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"}`}>
            {v.plate ?? v.name}
          </button>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="vehicles">Vehículos ({vehicles.length})</TabsTrigger>
          <TabsTrigger value="maintenance">Mantenimiento ({maintenance.length})</TabsTrigger>
          <TabsTrigger value="fuel">Combustible ({fuelLogs.length})</TabsTrigger>
          <TabsTrigger value="trips">Viajes ({trips.length})</TabsTrigger>
        </TabsList>

        {/* VEHICLES */}
        <TabsContent value="vehicles" className="mt-4">
          {vehicles.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Car className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No hay vehículos registrados aún</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {vehicles.map(v => {
                const sc = STATUS_CFG[v.status] ?? STATUS_CFG.available;
                const insExpired = isExpired(v.insurance_expiry);
                const insSoon = !insExpired && isExpiringSoon(v.insurance_expiry);
                const vtvExpired = isExpired(v.vtv_expiry);
                const vtvSoon = !vtvExpired && isExpiringSoon(v.vtv_expiry);
                return (
                  <Card key={v.id} className="overflow-hidden">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-base">{v.name}</CardTitle>
                          {v.plate && <p className="text-xs font-mono text-gray-500 mt-0.5">{v.plate}</p>}
                        </div>
                        <Badge className={`text-xs ${sc.color}`}>{sc.label}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {v.brand && <Badge variant="outline" className="text-xs">{v.brand} {v.model} {v.year}</Badge>}
                        <Badge variant="outline" className="text-xs">{FUEL_LABELS[v.fuel_type]}</Badge>
                        <Badge variant="outline" className="text-xs">{Number(v.odometer_km).toLocaleString("es-AR")} km</Badge>
                      </div>
                      {v.assigned_to_name && <p className="text-sm text-gray-600">👤 {v.assigned_to_name}</p>}
                      <div className="space-y-1">
                        {v.insurance_expiry && (
                          <p className={`text-xs flex items-center gap-1 ${insExpired ? "text-red-600 font-semibold" : insSoon ? "text-orange-600" : "text-gray-500"}`}>
                            {(insExpired || insSoon) && <AlertTriangle className="w-3 h-3" />}
                            Seguro: {new Date(v.insurance_expiry).toLocaleDateString("es-AR")}
                            {insExpired ? " (VENCIDO)" : insSoon ? " (próx. a vencer)" : ""}
                          </p>
                        )}
                        {v.vtv_expiry && (
                          <p className={`text-xs flex items-center gap-1 ${vtvExpired ? "text-red-600 font-semibold" : vtvSoon ? "text-orange-600" : "text-gray-500"}`}>
                            {(vtvExpired || vtvSoon) && <AlertTriangle className="w-3 h-3" />}
                            VTV: {new Date(v.vtv_expiry).toLocaleDateString("es-AR")}
                            {vtvExpired ? " (VENCIDA)" : vtvSoon ? " (próx. a vencer)" : ""}
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* MAINTENANCE */}
        <TabsContent value="maintenance" className="mt-4 space-y-2">
          {filteredMaint.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Wrench className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Sin mantenimientos registrados</p>
            </div>
          ) : filteredMaint.map(m => {
            const sc = MAINT_STATUS_CFG[m.status] ?? MAINT_STATUS_CFG.scheduled;
            const isExp = expandedMaint === m.id;
            return (
              <Card key={m.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <button onClick={() => setExpandedMaint(isExp ? null : m.id)} className="text-gray-400 flex-shrink-0">
                        {isExp ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900">{m.title}</p>
                        <p className="text-xs text-gray-500">{m.vehicles?.name} {m.vehicles?.plate && `(${m.vehicles.plate})`}</p>
                        {m.scheduled_date && <p className="text-xs text-gray-400">{new Date(m.scheduled_date).toLocaleDateString("es-AR")}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right">
                        {m.cost > 0 && <p className="text-sm font-semibold text-gray-900">{fmt(m.cost)}</p>}
                        <Badge className={`text-xs ${sc.color}`}>{sc.label}</Badge>
                      </div>
                      {m.status === "scheduled" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => completeMaintenance(m.id)}>
                          <CheckCircle className="w-3 h-3 mr-1" /> Completar
                        </Button>
                      )}
                    </div>
                  </div>
                  {isExp && (
                    <div className="mt-3 pt-3 border-t text-sm text-gray-600 space-y-1">
                      {m.description && <p>{m.description}</p>}
                      {m.provider_name && <p>🔧 {m.provider_name}</p>}
                      {m.notes && <p className="text-xs text-gray-400 italic">{m.notes}</p>}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* FUEL */}
        <TabsContent value="fuel" className="mt-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-gray-500">Total combustible: <span className="font-semibold text-gray-900">{fmt(filteredFuel.reduce((s, f) => s + Number(f.total_cost), 0))}</span></p>
          </div>
          {filteredFuel.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Fuel className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Sin cargas de combustible registradas</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">Fecha</th>
                    <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">Vehículo</th>
                    <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">Litros</th>
                    <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">Precio/L</th>
                    <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">Total</th>
                    <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">Odómetro</th>
                    <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">Estación</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFuel.map(f => (
                    <tr key={f.id} className="border-b hover:bg-gray-50">
                      <td className="py-2 px-3 text-gray-600">{new Date(f.date).toLocaleDateString("es-AR")}</td>
                      <td className="py-2 px-3 text-gray-900">{f.vehicles?.name ?? "—"}</td>
                      <td className="py-2 px-3 text-right text-gray-600">{Number(f.liters).toFixed(2)}</td>
                      <td className="py-2 px-3 text-right text-gray-600">{fmt(f.price_per_liter)}</td>
                      <td className="py-2 px-3 text-right font-semibold text-gray-900">{fmt(f.total_cost)}</td>
                      <td className="py-2 px-3 text-right text-gray-500">{f.odometer_km ? `${Number(f.odometer_km).toLocaleString("es-AR")} km` : "—"}</td>
                      <td className="py-2 px-3 text-gray-500">{f.station_name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* TRIPS */}
        <TabsContent value="trips" className="mt-4">
          <div className="mb-3">
            <p className="text-sm text-gray-500">Total km registrados: <span className="font-semibold text-gray-900">{filteredTrips.reduce((s, t) => s + Number(t.km_driven ?? 0), 0).toLocaleString("es-AR")} km</span></p>
          </div>
          {filteredTrips.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <MapPin className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Sin viajes registrados</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">Fecha</th>
                    <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">Vehículo</th>
                    <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">Conductor</th>
                    <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">Propósito</th>
                    <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">Ruta</th>
                    <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">Km</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTrips.map(t => (
                    <tr key={t.id} className="border-b hover:bg-gray-50">
                      <td className="py-2 px-3 text-gray-600">{new Date(t.start_time).toLocaleDateString("es-AR")}</td>
                      <td className="py-2 px-3 text-gray-900">{t.vehicles?.name ?? "—"}</td>
                      <td className="py-2 px-3 text-gray-900">{t.driver_name}</td>
                      <td className="py-2 px-3 text-gray-500">{t.purpose ?? "—"}</td>
                      <td className="py-2 px-3 text-gray-500">
                        {t.origin && t.destination ? `${t.origin} → ${t.destination}` : (t.origin || t.destination || "—")}
                      </td>
                      <td className="py-2 px-3 text-right font-semibold text-gray-900">
                        {t.km_driven != null ? `${Number(t.km_driven).toLocaleString("es-AR")} km` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
