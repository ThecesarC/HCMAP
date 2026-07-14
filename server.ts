import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Use raw and json body parsers
  app.use(express.json({ limit: '10mb' }));
  app.use(express.text({ type: 'application/xml', limit: '10mb' }));
  app.use(express.text({ type: 'text/plain', limit: '10mb' }));

  const kmlFilePath = path.join(process.cwd(), "src", "data", "current.kml");

  // API Route: Get currently persisted KML
  app.get("/api/kml", (req, res) => {
    try {
      if (fs.existsSync(kmlFilePath)) {
        const kmlData = fs.readFileSync(kmlFilePath, "utf-8");
        return res.json({ 
          success: true, 
          kml: kmlData, 
          source: "server_storage",
          name: "Capa Guardada"
        });
      } else {
        // Return null/not_found and let client use default Mexico sample
        return res.json({ 
          success: false, 
          kml: null,
          message: "No se ha guardado ningún KML en el servidor aún."
        });
      }
    } catch (error: any) {
      console.error("Error reading KML:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  // API Route: Persist KML in server
  app.post("/api/kml", (req, res) => {
    try {
      const { kmlText } = req.body;
      if (!kmlText || typeof kmlText !== "string") {
        return res.status(400).json({ success: false, error: "El cuerpo debe contener 'kmlText' como string." });
      }

      // Ensure directory exists
      const dir = path.dirname(kmlFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(kmlFilePath, kmlText, "utf-8");
      console.log("KML guardado correctamente en el servidor:", kmlFilePath);
      return res.json({ success: true, message: "KML guardado permanentemente en el servidor." });
    } catch (error: any) {
      console.error("Error writing KML:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  // API Route: Delete persisted KML from server (reset)
  app.delete("/api/kml", (req, res) => {
    try {
      if (fs.existsSync(kmlFilePath)) {
        fs.unlinkSync(kmlFilePath);
      }
      return res.json({ success: true, message: "KML borrado permanentemente del servidor." });
    } catch (error: any) {
      console.error("Error deleting KML:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  // Vite middleware for asset serving in development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT} in ${process.env.NODE_ENV || "development"} mode`);
  });
}

startServer();
