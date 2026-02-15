# Frontend Design Principles

## Design Thinking Process

Before writing any code, think through these dimensions:

1. **Purpose** -- what problem does this interface solve? Who uses it?
2. **Tone** -- commit to a BOLD aesthetic direction: brutally minimal, maximalist, retro-futuristic, organic, luxury, playful, editorial, brutalist, art deco, soft/pastel, industrial -- pick one and execute it with conviction
3. **Differentiation** -- what makes this unforgettable? What's the one thing someone will remember?
4. **Constraints** -- framework, performance, accessibility, responsive breakpoints

## Aesthetics Rules

### Typography
- Choose fonts that are beautiful, unique, and characterful
- **NEVER** use generic fonts: Arial, Inter, Roboto, system-ui defaults
- Pair a distinctive display font with a refined body font
- Size, weight, and letter-spacing matter -- tune them precisely

### Color & Theme
- Commit to a cohesive palette using CSS variables / SCSS variables / Flutter theme tokens
- Dominant color with sharp accents beats timid, evenly-distributed palettes
- **NEVER** default to purple gradients on white -- the hallmark of AI slop
- Vary between light and dark themes across projects
- Consider the emotional tone: warm, cool, electric, muted, earthy

### Motion & Interaction
- Use animations for delight: page-load reveals, staggered entries, hover surprises
- One well-orchestrated entrance sequence beats scattered micro-interactions
- Scroll-triggered reveals, parallax, and meaningful state transitions
- CSS-only for HTML; Angular animations for web; implicit/explicit animations for Flutter

### Spatial Composition
- Break the grid intentionally: asymmetry, overlap, diagonal flow
- Generous negative space OR controlled density -- both work if intentional
- Unexpected layouts over predictable card grids
- Z-depth through shadows, layering, and transparency

### Backgrounds & Atmosphere
- Create depth: gradient meshes, noise textures, geometric patterns, grain overlays
- Layered transparencies, dramatic shadows, decorative borders
- **NEVER** default to flat solid white/gray backgrounds without purpose

## Anti-Patterns -- What to Avoid

- Overused font families (Inter, Roboto, Arial, Space Grotesk, system fonts)
- Cliche color schemes (purple gradients on white, generic blue-on-gray)
- Predictable card-grid layouts with no spatial personality
- Cookie-cutter components that look like every other AI-generated UI
- Converging on the same choices across different designs -- every project should feel unique

## Quality Checklist

Before delivering any UI, verify:
- Clear aesthetic direction -- can you name the style in 2-3 words?
- No generic fonts or default color schemes
- At least one moment of delight (animation, hover effect, scroll interaction)
- Responsive across mobile to desktop
- Accessible (contrast ratios, focus states, semantic HTML / Flutter semantics)
- Theme tokens / CSS variables for consistency
- Production-ready -- no placeholders or TODOs in shipped UI

## Key Principle

Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate animations and effects. Minimalist designs need restraint, precision, and meticulous spacing. Elegance comes from executing the vision well, not from intensity.
