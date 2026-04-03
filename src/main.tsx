import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { seedProducts } from "./lib/seedData";

// Seed products from Excel data if no products exist
seedProducts();

createRoot(document.getElementById("root")!).render(<App />);
