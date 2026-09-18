interface HeadingProps {
  title: string;
  description: string;
}

export const Heading: React.FC<HeadingProps> = ({ title, description }) => {
  return (
    <div className='min-w-0'>
      <h2 className='text-2xl font-bold text-balance'>{title}</h2>
      <p className='text-muted-foreground mt-1 max-w-3xl text-sm text-pretty'>
        {description}
      </p>
    </div>
  );
};
