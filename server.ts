import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Use raw and json body parsers
  app.use(express.json({ limit: '50mb' }));
  app.use(express.text({ type: 'application/xml', limit: '50mb' }));
  app.use(express.text({ type: 'text/plain', limit: '50mb' }));

  const kmlFilePath = path.join(process.cwd(), "src", "data", "current.kml");
  const districtsFilePath = path.join(process.cwd(), "src", "data", "districts.json");

  // API Route: Get currently persisted Districts structure
  app.get("/api/districts", (req, res) => {
    try {
      if (fs.existsSync(districtsFilePath)) {
        const districtsRaw = fs.readFileSync(districtsFilePath, "utf-8");
        const parsed = JSON.parse(districtsRaw);
        const districts = Array.isArray(parsed) ? parsed : (parsed.districts || []);
        const stat = fs.statSync(districtsFilePath);
        const updatedAt = (!Array.isArray(parsed) && parsed.updatedAt) ? parsed.updatedAt : Math.floor(stat.mtimeMs);
        return res.json({ 
          success: true, 
          districts: districts,
          updatedAt: updatedAt,
          source: "server_storage"
        });
      } else {
        return res.json({ 
          success: false, 
          districts: null,
          updatedAt: 0,
          message: "No hay distritos guardados en el servidor aún."
        });
      }
    } catch (error: any) {
      console.error("Error reading districts:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  // API Route: Persist Districts structure in server
  app.post("/api/districts", (req, res) => {
    try {
      const { districts, kmlText, updatedAt } = req.body;
      if (!districts || !Array.isArray(districts)) {
        return res.status(400).json({ success: false, error: "El cuerpo debe contener 'districts' como array." });
      }

      const dir = path.dirname(districtsFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const savePayload = {
        districts,
        updatedAt: updatedAt || Date.now()
      };

      // Save districts.json with timestamp
      fs.writeFileSync(districtsFilePath, JSON.stringify(savePayload, null, 2), "utf-8");

      // Save combined current.kml if provided or extract from districts
      let mainKmlText = kmlText;
      if (!mainKmlText) {
        const texts: string[] = [];
        districts.forEach((d: any) => {
          (d.kmlFiles || []).forEach((f: any) => {
            if (f.kmlText) texts.push(f.kmlText);
          });
        });
        if (texts.length > 0) mainKmlText = texts.join('\n\n');
      }

      if (mainKmlText && typeof mainKmlText === 'string') {
        fs.writeFileSync(kmlFilePath, mainKmlText, "utf-8");
      }

      console.log("Distritos y KML guardados en servidor:", districtsFilePath);
      return res.json({ success: true, message: "Distritos guardados permanentemente en servidor.", updatedAt: savePayload.updatedAt });
    } catch (error: any) {
      console.error("Error writing districts:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });

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
