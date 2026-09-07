/**
 * StorefrontHeader — Header minimalista para storefront
 *
 * Principios:
 * - Minimalista y focused en conversión
 * - Foco en búsqueda y carrito
 * - Navigation secundaria
 * - Brand personalizable por tienda
 */
import { Link, useLocation } from "react-router-dom";
import { Search, ShoppingCart, Menu, X, Heart, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface StorefrontHeaderProps {
  storeName: string;
  storeSlug: string;
  cartItems?: number;
}

export default function StorefrontHeader({ storeName, storeSlug, cartItems = 0 }: StorefrontHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <header className="storefront-header sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo y Brand */}
        <div className="flex items-center gap-4">
          <Link to={`/tienda/${storeSlug}`} className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">{storeName.charAt(0)}</span>
            </div>
            <span className="font-semibold text-lg hidden sm:block">{storeName}</span>
          </Link>
        </div>

        {/* Search (desktop) */}
        <div className="hidden md:flex flex-1 max-w-xl mx-8">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Buscar productos..."
              className="w-full pl-10 h-10 bg-muted/50 border-0 focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* Search (mobile) */}
          <Button
            variant="ghost"
            size="sm"
            className="md:hidden h-10 w-10 p-0"
            onClick={() => setSearchOpen(!searchOpen)}
          >
            <Search className="h-5 w-5" />
          </Button>

          {/* Wishlist */}
          <Button variant="ghost" size="sm" className="hidden sm:flex h-10 w-10 p-0">
            <Heart className="h-5 w-5" />
          </Button>

          {/* Cart */}
          <Link to={`/tienda/${storeSlug}/carrito`} className="relative">
            <Button variant="ghost" size="sm" className="h-10 w-10 p-0">
              <ShoppingCart className="h-5 w-5" />
            </Button>
            {cartItems > 0 && (
              <Badge className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-[10px] bg-primary text-primary-foreground">
                {cartItems}
              </Badge>
            )}
          </Link>

          {/* User */}
          <Button variant="ghost" size="sm" className="hidden sm:flex h-10 w-10 p-0">
            <User className="h-5 w-5" />
          </Button>

          {/* Mobile Menu */}
          <Button
            variant="ghost"
            size="sm"
            className="md:hidden h-10 w-10 p-0"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile Search */}
      {searchOpen && (
        <div className="md:hidden border-t border-border/40 p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Buscar productos..."
              className="w-full pl-10 h-10 bg-muted/50 border-0"
              autoFocus
            />
          </div>
        </div>
      )}

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-border/40 p-4 space-y-4">
          <Link
            to={`/tienda/${storeSlug}`}
            className="block py-2 text-sm font-medium hover:text-primary"
            onClick={() => setMobileMenuOpen(false)}
          >
            Inicio
          </Link>
          <Link
            to={`/tienda/${storeSlug}/productos`}
            className="block py-2 text-sm font-medium hover:text-primary"
            onClick={() => setMobileMenuOpen(false)}
          >
            Productos
          </Link>
          <Link
            to={`/tienda/${storeSlug}/nosotros`}
            className="block py-2 text-sm font-medium hover:text-primary"
            onClick={() => setMobileMenuOpen(false)}
          >
            Nosotros
          </Link>
          <Link
            to={`/tienda/${storeSlug}/contacto`}
            className="block py-2 text-sm font-medium hover:text-primary"
            onClick={() => setMobileMenuOpen(false)}
          >
            Contacto
          </Link>
        </div>
      )}
    </header>
  );
}
