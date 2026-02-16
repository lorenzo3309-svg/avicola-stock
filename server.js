
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

app.post('/login', async(req,res)=>{
  const {nombre,password}=req.body;

  const r=await pool.query('SELECT * FROM usuarios WHERE nombre=$1',[nombre]);
  if(!r.rows.length) return res.status(401).send("Usuario no existe");

  const ok=await bcrypt.compare(password,r.rows[0].password);
  if(!ok) return res.status(401).send("Contraseña incorrecta");

  const token=jwt.sign(
    {id:r.rows[0].id,rol:r.rows[0].rol},
    SECRET,
    {expiresIn:'7d'}
  );

  res.send({token});
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
      SELECT categoria,SUM(cantidad) AS contado
      FROM conteos GROUP BY categoria
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

