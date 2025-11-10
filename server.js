// IMPORTANT: Replace the placeholder origin with your actual Mini App domain!
const corsOptions = {
    origin: '*', // For testing, allow all. In production, restrict to your Telegram Mini App domain.
    methods: ['POST'],
    allowedHeaders: ['Content-Type'],
};
app.use(cors(corsOptions));
