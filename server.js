const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { MongoMemoryServer } = require('mongodb-memory-server');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// CORS - Deve vir ANTES do Helmet para evitar conflitos
app.use(cors({
  origin: function (origin, callback) {
    const allowedOrigins = process.env.CORS_ORIGIN ? 
      process.env.CORS_ORIGIN.split(',') : 
      ['https://frontend-01-theta.vercel.app'];
    
    // Permitir requisições sem origin (ex: Postman, mobile apps)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Não permitido pelo CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Length', 'X-Foo', 'X-Bar'],
  preflightContinue: false,
  optionsSuccessStatus: 200
}));

// Middlewares de Segurança - Configurado para não interferir com CORS
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false
}));

// Rate Limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutos
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // máximo 100 requests por IP
  message: {
    error: 'Muitas tentativas. Tente novamente em alguns minutos.',
    code: 'RATE_LIMIT_EXCEEDED'
  }
});
app.use('/api/', limiter);

// Middleware para tratar requisições OPTIONS (preflight)
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400'); // 24 horas
  res.sendStatus(200);
});

// Body Parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Conectar ao MongoDB
let isConnected = false;

const connectDB = async () => {
  if (isConnected) {
    return;
  }
  
  try {
    let mongoURI = process.env.MONGODB_URI || process.env.MONGODB_URI_PROD;
    
    if (!mongoURI) {
      console.log('⚠️ MongoDB URI não configurado, usando MongoDB Memory Server...');
      
      // Usar MongoDB Memory Server como fallback
      const mongod = await MongoMemoryServer.create();
      mongoURI = mongod.getUri();
      
      console.log('📝 Nota: Usando banco de dados em memória para desenvolvimento');
    }
    
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 10,
      bufferCommands: false,
    });
    
    isConnected = true;
    console.log('✅ Conectado ao MongoDB');
  } catch (error) {
    console.error('❌ Erro ao conectar com MongoDB:', error.message);
    throw error;
  }
};

// Middleware de debug para CORS
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  console.log('Origin:', req.headers.origin);
  console.log('Headers:', req.headers);
  
  // Definir headers CORS manualmente como backup
  res.header('Access-Control-Allow-Origin', req.headers.origin || 'https://frontend-01-theta.vercel.app');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  
  next();
});

// Middleware para conectar ao DB antes de cada request
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Erro de conexão com banco de dados'
    });
  }
});

// Importar rotas
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const investmentRoutes = require('./routes/investments');
const pixRoutes = require('./routes/pix');
const asaasRoutes = require('./routes/asaas');
const transactionRoutes = require('./routes/transactions');

// Usar rotas
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/investments', investmentRoutes);
app.use('/api/pix', pixRoutes);
app.use('/api/asaas', asaasRoutes);
app.use('/api/transactions', transactionRoutes);

// Rota de health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
  });
});

// Rota raiz
app.get('/', (req, res) => {
  res.json({
    message: 'Furby Investimentos API',
    version: '1.0.0',
    status: 'Online',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      users: '/api/users',
      investments: '/api/investments',
      pix: '/api/pix',
      asaas: '/api/asaas',
      transactions: '/api/transactions'
    }
  });
});

// Middleware de tratamento de erros
app.use((error, req, res, next) => {
  console.error('❌ Erro no servidor:', error);
  
  // Erro de validação do Mongoose
  if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map(err => err.message);
    return res.status(400).json({
      success: false,
      message: 'Dados inválidos',
      errors
    });
  }
  
  // Erro de duplicação (email já existe)
  if (error.code === 11000) {
    return res.status(400).json({
      success: false,
      message: 'Email já cadastrado no sistema'
    });
  }
  
  // Erro de JWT
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Token inválido'
    });
  }
  
  // Erro genérico
  res.status(500).json({
    success: false,
    message: 'Erro interno do servidor',
    ...(process.env.NODE_ENV === 'development' && { error: error.message })
  });
});

// Rota 404 para API
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint não encontrado'
  });
});

// Iniciar servidor
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor Backend rodando na porta ${PORT}`);
    console.log(`🔗 API: http://localhost:${PORT}/api`);
    console.log(`📊 Health Check: http://localhost:${PORT}/api/health`);
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🔄 Recebido SIGTERM. Fechando servidor graciosamente...');
  mongoose.connection.close(() => {
    console.log('📦 Conexão MongoDB fechada.');
    process.exit(0);
  });
});

module.exports = app;