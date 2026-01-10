interface AvatarProps {
  name?: string;
  size?: number;
}

export function Avatar({ name = 'Matthew Maday', size = 32 }: AvatarProps) {
  // Get initials from name
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div
      className="rounded-full flex items-center justify-center text-[#FFFFFF] font-medium border border-[#EAEAEA]"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      }}
    >
      {initials}
    </div>
  );
}
