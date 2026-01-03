import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.GEMINI_API_KEY;

async function checkModels() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.models) {
      console.log('Available models:');
      data.models.forEach((m: any) => {
        if (m.name.includes('gemini')) {
          console.log(`- ${m.name} (${m.supportedGenerationMethods.join(', ')})`);
        }
      });
    } else {
      console.error('No models found or error:', data);
    }
  } catch (error) {
    console.error('Fetch error:', error);
  }
}

checkModels();

