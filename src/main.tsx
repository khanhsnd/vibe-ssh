import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/app.css";

// Mở UI trên trình duyệt thường (không có Tauri) thì dùng backend giả để thử luồng.
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  (await import("./dev/mock")).installMock();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
