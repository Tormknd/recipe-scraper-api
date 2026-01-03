import { z } from 'zod';
import ip from 'ip';
import { URL } from 'url';

// Liste des domaines interdits (localhost, etc)
const BLOCKED_HOSTNAMES = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];

/**
 * Valide que l'URL est sûre (HTTP/HTTPS uniquement, pas d'IP locale)
 * Empêche les attaques SSRF (Server Side Request Forgery)
 */
const safeUrlSchema = z.string().url().refine((val) => {
  try {
    const url = new URL(val);
    
    // 1. Protocole strict
    if (!['http:', 'https:'].includes(url.protocol)) {
      return false;
    }

    // 2. Pas de localhost
    if (BLOCKED_HOSTNAMES.includes(url.hostname)) {
      return false;
    }

    // 3. Pas d'IP privée (si le hostname est une IP)
    if (ip.isV4Format(url.hostname) || ip.isV6Format(url.hostname)) {
      if (ip.isPrivate(url.hostname)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}, {
  message: "URL invalide ou non autorisée (Localhost/IP privées interdites)"
});

export const validateRequest = z.object({
  url: safeUrlSchema
});

