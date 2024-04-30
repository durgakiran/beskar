import { HTMLProps, forwardRef } from 'react'

export type SurfaceProps = HTMLProps<HTMLDivElement> & {
  withShadow?: boolean
  withBorder?: boolean
}

export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(
  ({ children, className, withShadow = true, withBorder = true, ...props }, ref) => {

    return (
      <div className="shadow-sm bg-white rounded-lg border border-neutral-200" {...props} ref={ref}>
        {children}
      </div>
    )
  },
)

Surface.displayName = 'Surface'
