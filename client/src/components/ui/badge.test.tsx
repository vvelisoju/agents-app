// QA-51 — a component-render smoke test proving the jsdom + Testing Library harness works
// end-to-end (render, query, assert on the real DOM).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './badge';

describe('Badge', () => {
  it('renders its children and applies the variant tone', () => {
    render(<Badge variant="good">Active</Badge>);
    const el = screen.getByText('Active');
    expect(el).toBeInTheDocument();
    expect(el.className).toContain('text-good');
  });
});
