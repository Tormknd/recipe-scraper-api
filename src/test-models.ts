import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(API_KEY || '');

async function listModels() {
  try {
    // Note: older SDK versions might not have listModels easily accessible or it's on a specific manager
    // But let's try to infer or just test a few specific ones if listModels isn't straightforward in this version
    // Actually, let's just test connectivity
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent('Hello');
    console.log('gemini-1.5-flash works:', result.response.text());
  } catch (e: any) {
    console.log('gemini-1.5-flash failed:', e.message);
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
    const result = await model.generateContent('Hello');
    console.log('gemini-1.5-pro works:', result.response.text());
  } catch (e: any) {
    console.log('gemini-1.5-pro failed:', e.message);
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    const result = await model.generateContent('Hello');
    console.log('gemini-pro works:', result.response.text());
  } catch (e: any) {
    console.log('gemini-pro failed:', e.message);
  }
}

listModels();

