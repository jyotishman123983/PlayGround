export const VIDEO_STYLES = [
  {
    id: 'cinematic',
    name: 'Cinematic',
    description: 'Filmic lighting, dramatic camera moves and rich color grading.',
    prompt: 'cinematic lighting, shallow depth of field, dramatic camera movement, rich color grade'
  },
  {
    id: 'anime',
    name: 'Anime',
    description: 'Stylized anime frames with expressive characters and motion.',
    prompt: 'high quality anime style, expressive characters, dynamic action lines, vibrant cel shading'
  },
  {
    id: 'documentary',
    name: 'Documentary',
    description: 'Grounded, realistic storytelling with natural motion.',
    prompt: 'realistic documentary footage, natural lighting, handheld camera, authentic detail'
  },
  {
    id: 'product',
    name: 'Product Ad',
    description: 'Clean studio product shots built for conversion.',
    prompt: 'premium product commercial, studio lighting, macro detail, smooth orbit camera, clean background'
  },
  {
    id: 'explainer',
    name: 'Explainer',
    description: 'Clear visual storytelling with motion graphics energy.',
    prompt: 'clean explainer visual, motion graphics accents, clear composition, smooth transitions'
  },
  {
    id: 'social',
    name: 'Social Hook',
    description: 'Fast, thumb-stopping scenes optimised for the first 3 seconds.',
    prompt: 'high energy social video, bold composition, fast cuts, scroll-stopping hook, vivid colors'
  }
];

export const MODES = ['text-to-video', 'image-to-video'];

export function getStyle(id) {
  return VIDEO_STYLES.find(style => style.id === id) || null;
}
