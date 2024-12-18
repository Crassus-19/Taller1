const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const PDFDocument = require("pdfkit");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 8080; // Ajustar al puerto de Azure App Service

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"))); // Carpeta pública para archivos estáticos

// Log de solicitudes HTTP
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Base de datos SQLite
const db = new sqlite3.Database("./database.db", (err) => {
  if (err) {
    console.error("Error al conectar a SQLite:", err.message);
    process.exit(1); // Detener el servidor si hay un error crítico
  }
  console.log("Conexión a SQLite exitosa.");
});

// Crear tabla si no existe
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS registros (
      folio INTEGER PRIMARY KEY AUTOINCREMENT,
      unidad TEXT NOT NULL,
      tipoMedida TEXT NOT NULL,
      kilometrajeHoras TEXT NOT NULL,
      fecha TEXT NOT NULL,
      tipoOrden TEXT NOT NULL,
      comentarios TEXT,
      reporta TEXT NOT NULL
    )
  `);
});

// Ruta principal para verificar que el servidor está en ejecución
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Ruta para obtener registros con filtros y ordenamiento
app.get("/api/registros", (req, res) => {
  const { unidad, tipoOrden, fecha, sortBy, order } = req.query;

  let query = "SELECT * FROM registros";
  const params = [];
  const conditions = [];

  if (unidad) {
    conditions.push("unidad LIKE ?");
    params.push(`%${unidad}%`);
  }
  if (tipoOrden) {
    conditions.push("tipoOrden LIKE ?");
    params.push(`%${tipoOrden}%`);
  }
  if (fecha) {
    conditions.push("fecha = ?");
    params.push(fecha);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }

  if (sortBy) {
    const validColumns = ["folio", "fecha", "unidad"];
    if (validColumns.includes(sortBy)) {
      query += ` ORDER BY ${sortBy} ${order === "desc" ? "DESC" : "ASC"}`;
    }
  }

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error("Error al obtener registros:", err.message);
      return res.status(500).json({ error: "Error al obtener los registros" });
    }
    res.json(rows);
  });
});

// Ruta para guardar un nuevo registro
app.post("/api/registros", (req, res) => {
  const { unidad, tipoMedida, kilometrajeHoras, tipoOrden, comentarios, reporta } = req.body;
  if (!unidad || !tipoMedida || !kilometrajeHoras || !tipoOrden || !reporta) {
    return res.status(400).json({ error: "Todos los campos son obligatorios" });
  }

  const fecha = new Date().toISOString().split("T")[0];
  db.run(
    "INSERT INTO registros (unidad, tipoMedida, kilometrajeHoras, fecha, tipoOrden, comentarios, reporta) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [unidad, tipoMedida, kilometrajeHoras, fecha, tipoOrden, comentarios, reporta],
    function (err) {
      if (err) {
        console.error("Error al insertar registro:", err.message);
        return res.status(500).json({ error: "Error al guardar el registro" });
      }
      res.json({ folio: this.lastID, fecha });
    }
  );
});

// Ruta para generar un PDF de un registro específico
app.get("/api/registros/:folio/pdf", (req, res) => {
  const { folio } = req.params;

  db.get("SELECT * FROM registros WHERE folio = ?", [folio], (err, row) => {
    if (err || !row) return res.status(500).json({ error: "Registro no encontrado" });

    const doc = new PDFDocument({ margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=registro_${folio}.pdf`);
    doc.pipe(res);

    // Función para escribir contenido en el PDF
    function escribirContenido(yOffset) {
      const logoPath = path.join(__dirname, "logo_fletes_tauro.png");
      if (fs.existsSync(logoPath)) {
        doc.save();
        doc.fillOpacity(0.35);
        doc.image(logoPath, 70, 25 + yOffset, { width: 500 });
        doc.restore();
      }

      doc.font("Helvetica-Bold").fontSize(20).text("Reporte de Taller", { align: "center" });
      doc.moveTo(50, 100 + yOffset).lineTo(550, 100 + yOffset).stroke();

      doc.fontSize(12).text(`Fecha: ${row.fecha}`, 50, 80 + yOffset, { align: "left" });
      doc.text(`Folio: ${row.folio}`, 450, 80 + yOffset, { align: "right" });

      doc.moveDown(1);
      doc.font("Helvetica-Bold").text("Unidad:", 50, doc.y, { align: "left" });
      doc.font("Helvetica").text(row.unidad, 150, doc.y - 15);

      doc.font("Helvetica-Bold").text(`${row.tipoMedida}:`, 50, doc.y, { align: "left" });
      doc.font("Helvetica").text(row.kilometrajeHoras, 150, doc.y - 15);

      doc.font("Helvetica-Bold").text("Tipo de Orden:", 50, doc.y, { align: "left" });
      doc.font("Helvetica").text(row.tipoOrden, 150, doc.y - 15);

      doc.font("Helvetica-Bold").text("Quién Reporta:", 50, doc.y, { align: "left" });
      doc.font("Helvetica").text(row.reporta, 150, doc.y - 15);

      doc.moveDown(1);
      doc.rect(50, doc.y, 500, 80).stroke();
      doc.font("Helvetica-Bold").text("Comentarios:", 60, doc.y + 10, { align: "left" });
      doc.font("Helvetica").text(row.comentarios, 60, doc.y + 10);

      doc.moveDown(2);
      doc.moveTo(200, doc.y + 30).lineTo(400, doc.y + 30).stroke();
      doc.font("Helvetica-Bold").fontSize(12).text("Firma", 50, doc.y + 40, { align: "center" });
      doc.moveDown(8);
    }

    // Escribir contenido duplicado en la misma página
    escribirContenido(0);
    escribirContenido(400);

    doc.end();
  });
});

// Middleware de manejo de errores
app.use((err, req, res, next) => {
  console.error("Error en el servidor:", err.message);
  res.status(500).json({ error: "Error interno del servidor" });
});

// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
