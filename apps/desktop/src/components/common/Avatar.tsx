interface AvatarProps {
  name: string;
  src?: string | null;
  colour?: string;
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = {
  sm: 'w-8 h-8 text-[11px]',
  md: 'w-9 h-9 text-[12px]',
  lg: 'w-11 h-11 text-sm',
};

// Generate a consistent color from a name
function nameToColor(name: string): string {
  const colors = ['#5865F2', '#57F287', '#FEE75C', '#EB459E', '#ED4245', '#00FFC8', '#F0B232', '#00B4D8'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

export default function Avatar({ name, src, colour, size = 'md' }: AvatarProps) {
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const bg = colour || nameToColor(name);

  if (src) {
    // If src is a relative API path, prepend the server URL
    const imgSrc = src.startsWith('/') ? `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}${src}` : src;
    return (
      <img
        src={imgSrc}
        alt={name}
        className={`${sizeMap[size]} rounded-full object-cover shrink-0`}
      />
    );
  }

  return (
    <div
      className={`${sizeMap[size]} rounded-full flex items-center justify-center font-bold shrink-0`}
      style={{ backgroundColor: bg, color: '#000' }}
    >
      {initials}
    </div>
  );
}
