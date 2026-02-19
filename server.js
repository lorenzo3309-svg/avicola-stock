
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const ExcelJS = require('exceljs');

const app = express();

const corsOptions = {
  origin: "https://soft-begonia-e85396.netlify.app",
  methods: ["GET","POST","PUT","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
  credentials: true
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(express.json());

const SECRET = process.env.SECRET || "clave_super_secreta";
const cs = process.env.DATABASE_URL;
console.log("DB_URL exists:", !!cs);

try {
  const u = new URL(cs);
  console.log("DB host:", u.hostname);
  console.log("DB port:", u.port);
  console.log("DB user:", decodeURIComponent(u.username));
} catch (e) {
  console.log("DATABASE_URL inválida o vacía");
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function auth(req,res,next){
  const token = req.headers.authorization;
  if(!token) return res.status(401).send("No autorizado");
  try{
    req.user = jwt.verify(token, SECRET);
    next();
  }catch{
    res.status(401).send("Token inválido");
  }
}

app.get('/', (req,res)=>res.send("API Avicola funcionando"));

app.post("/login", async (req, res) => {
  try {
    const { usuario, password } = req.body;

    if (!usuario || !password) {
      return res.status(400).json({ error: "Datos incompletos" });
    }

    const result = await pool.query(
      "SELECT * FROM public.usuarios WHERE usuario = $1",
      [usuario]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Usuario no encontrado" });
    }

    const user = result.rows[0];

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    const token = jwt.sign(
      { id: user.id, usuario: user.usuario },
      SECRET,
      { expiresIn: "8h" }
    );

    res.json({ token });
  } catch (error) {
    console.error("❌ Error en /login:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

app.post('/movimiento', auth, async(req,res)=>{
  const {categoria,cantidad,tipo}=req.body;

  await pool.query(
    `INSERT INTO movimientos(categoria,cantidad,tipo,usuario)
     VALUES($1,$2,$3,$4)`,
    [categoria,cantidad,tipo,req.user.id]
  );

  res.send({ok:true});
});

app.post('/conteo', auth, async(req,res)=>{
  const {categoria,cantidad}=req.body;

  await pool.query(
    `INSERT INTO conteos(categoria,cantidad,usuario)
     VALUES($1,$2,$3)`,
    [categoria,cantidad,req.user.id]
  );

  res.send({ok:true});
});

app.get('/stock', auth, async(req,res)=>{
  const r=await pool.query(`
    SELECT categoria,
    SUM(CASE WHEN tipo='entrada' THEN cantidad ELSE 0 END) -
    SUM(CASE WHEN tipo='salida' THEN cantidad ELSE 0 END) AS stock
    FROM movimientos
    GROUP BY categoria
    ORDER BY categoria
  `);
  res.send(r.rows);
});

app.get('/diferencias', auth, async(req,res)=>{  
  const r=await pool.query(`  
    SELECT m.categoria,  
    SUM(CASE WHEN tipo='entrada' THEN cantidad ELSE 0 END) -  
    SUM(CASE WHEN tipo='salida' THEN cantidad ELSE 0 END) AS teorico,  
    COALESCE(c.contado,0) AS fisico,  
    COALESCE(c.contado,0) -  
    (SUM(CASE WHEN tipo='entrada' THEN cantidad ELSE 0 END) -  
     SUM(CASE WHEN tipo='salida' THEN cantidad ELSE 0 END)) AS diferencia  
    FROM movimientos m  
    LEFT JOIN (  
      SELECT DISTINCT ON (categoria)
        categoria,
        cantidad AS contado
      FROM conteos
      ORDER BY categoria, id DESC
    ) c ON m.categoria=c.categoria  
    GROUP BY m.categoria,c.contado  
    ORDER BY m.categoria  
  `);  
  res.send(r.rows);  
});

app.get('/alertas', auth, async(req,res)=>{
  const r=await pool.query(`
    SELECT categoria,
    SUM(CASE WHEN tipo='entrada' THEN cantidad ELSE 0 END) -
    SUM(CASE WHEN tipo='salida' THEN cantidad ELSE 0 END) AS stock
    FROM movimientos
    GROUP BY categoria
    HAVING SUM(CASE WHEN tipo='entrada' THEN cantidad ELSE 0 END) -
           SUM(CASE WHEN tipo='salida' THEN cantidad ELSE 0 END) < 0
  `);
  res.send({stockNegativo:r.rows});
});

app.get('/excel', auth, async(req,res)=>{
  const movimientos=await pool.query(
    'SELECT categoria,cantidad,tipo,usuario,fecha FROM movimientos ORDER BY fecha DESC'
  );

  const workbook=new ExcelJS.Workbook();
  const sheet=workbook.addWorksheet('Movimientos');

  sheet.columns=[
    {header:'Fecha',key:'fecha',width:20},
    {header:'Usuario',key:'usuario',width:15},
    {header:'Categoria',key:'categoria',width:25},
    {header:'Tipo',key:'tipo',width:12},
    {header:'Cantidad',key:'cantidad',width:12}
  ];

  movimientos.rows.forEach(r=>sheet.addRow(r));

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    'attachment; filename=control_avicola.xlsx'
  );

  await workbook.xlsx.write(res);
  res.end();
});

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log("Sistema avícola online"));








