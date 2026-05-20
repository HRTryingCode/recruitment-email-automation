import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { errorHandler } from './middleware/error';
import mailboxesRouter from './routes/mailboxes';
import candidatesRouter from './routes/candidates';
import emailsRouter from './routes/emails';
import draftsRouter from './routes/drafts';
import webhooksRouter from './routes/webhooks';
import healthRouter from './routes/health';

const app = express();

// Security middleware
app.use(helmet());

app.use(
  cors({
    origin: config.frontendUrl,
    credentials: true,
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/mailboxes', mailboxesRouter);
app.use('/api/candidates', candidatesRouter);
app.use('/api/emails', emailsRouter);
app.use('/api/drafts', draftsRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/health', healthRouter);

// Error handler (must be last)
app.use(errorHandler);

export default app;
