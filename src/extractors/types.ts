export interface ExtractedComment {
  text: string;
  author?: string;
  likes?: number;
}

export interface PlatformPostMetadata {
  platform: 'tiktok' | 'instagram';
  description: string;
  title?: string;
  comments: ExtractedComment[];
  videoDownloadUrl?: string;
  videoId?: string;
  source: 'embedded_json' | 'graphql' | 'dom';
}
