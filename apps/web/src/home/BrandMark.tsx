/** Flow Systems' mark: a verdigris tile with three terrazzo chips. Decorative, so label the link around it. */
export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`relative block size-8 shrink-0 rounded-[10px] bg-[var(--ff-accent,#1F5A50)] ${className}`}>
      <span className="absolute top-[7px] left-[8px] size-[5px] rounded-full bg-[#E8A58F]" />
      <span className="absolute top-[14px] left-[18px] size-[4px] rounded-full bg-[#E6C27A]" />
      <span className="absolute top-[20px] left-[9px] size-[6px] rounded-full bg-[#9CC3B6]" />
    </span>
  )
}
