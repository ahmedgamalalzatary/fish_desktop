import React from "react";
import ReactDOM from "react-dom/client";
import { shop } from "@shop";
import App from "./App";
import { ToastProvider } from "./lib/toast";
import "./index.css";

document.title = shop.title;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>,
);
