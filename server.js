const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const PDFDocument = require("pdfkit");
const fs = require("fs");

const app = express();
const PORT = 8080;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Base de datos SQLite
const db = new sqlite3.Database("./database.db", (err) => {
  if (err) {
    console.error("Error al conectar a SQLite:", err.message);
    return;
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

// Ruta para servir el archivo HTML principal
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Ruta para obtener registros con filtros y ordenamiento
app.get("/api/registros", (req, res) => {
  const { unidad, tipoOrden, fecha, sortBy, order } = req.query;

  // Base de la consulta
  let query = "SELECT * FROM registros";
  const params = [];

  // Aplicar filtros dinámicamente
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

  // Aplicar ordenamiento
  if (sortBy) {
    const validColumns = ["folio", "fecha", "unidad"];
    if (validColumns.includes(sortBy)) {
      query += ` ORDER BY ${sortBy} ${order === "desc" ? "DESC" : "ASC"}`;
    }
  }

  // Ejecutar la consulta
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

    // Contenido del PDF
    doc.fontSize(20).text("Reporte de Taller", { align: "center" });
    doc.moveTo(50, 100).lineTo(550, 100).stroke();

    doc.fontSize(12);
    doc.text(`Fecha: ${row.fecha}`, 50, 120);
    doc.text(`Folio: ${row.folio}`, 450, 120);

    doc.moveDown(1);
    doc.text(`Unidad: ${row.unidad}`);
    doc.text(`${row.tipoMedida}: ${row.kilometrajeHoras}`);
    doc.text(`Tipo de Orden: ${row.tipoOrden}`);
    doc.text(`Quién Reporta: ${row.reporta}`);

    doc.moveDown(1);
    doc.text("Comentarios:");
    doc.rect(50, doc.y, 500, 100).stroke();
    doc.text(row.comentarios, 60, doc.y + 10);

    doc.end();
  });
});

// Servidor escuchando
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
