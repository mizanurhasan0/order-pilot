'use client';

import type { ReactNode } from 'react';
import { ExternalLink, Share2 } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { CopyTextButton } from '@/components/ui/CopyTextButton';
import { Drawer } from '@/components/ui/Drawer';
import { ProductImage } from '@/components/ui/ProductImage';
import { formatMoney } from '@/lib/format';
import { facebookShareUrl, getFacebookPageUsername, messengerProductLink, productPostText } from '@/lib/messenger';
import type { Product } from '@/lib/types';

// Builds the m.me link of one product for a Facebook post. A customer who taps it lands in
// Messenger with the product already chosen, and the bot asks for the quantity straight away.
// Render with key={product.id} so the copy buttons reset per product.
export function ShareProductDrawer({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const pageUsername = getFacebookPageUsername();
  const link = product && pageUsername ? messengerProductLink(pageUsername, product.id) : null;

  return (
    <Drawer
      open={product !== null}
      onClose={onClose}
      eyebrow="Share to Facebook"
      title={product?.id ?? ''}
      footer={link ? <ShareFooter link={link} /> : undefined}
    >
      {product && (
        <>
          <ProductSummary product={product} />
          {!product.available && (
            <Alert tone="warning" title="This product is unavailable">
              Customers who open the link are told the product was not found, until it is available again.
            </Alert>
          )}
          {link ? <ShareDetails product={product} link={link} /> : <PageNotSet />}
        </>
      )}
    </Drawer>
  );
}

function ProductSummary({ product }: { product: Product }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-line p-3">
      <ProductImage src={product.imageUrl} alt={product.name} size="md" />
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[.14em] text-brand-500">{product.category}</p>
        <p className="mt-1 line-clamp-2 text-sm font-semibold leading-5 text-ink">{product.name}</p>
        <p className="mt-1 text-base font-bold tracking-tight text-brand-700">
          {formatMoney(product.price, product.currency)}
        </p>
      </div>
    </div>
  );
}

function ShareDetails({ product, link }: { product: Product; link: string }) {
  const postText = productPostText(product, link);
  const fieldClass = 'w-full rounded-xl border border-line bg-canvas px-3 py-2.5 text-ink outline-none focus:border-brand-200';

  return (
    <>
      <Section title="Messenger link" hint="Opens Messenger with this product selected.">
        <input
          readOnly
          value={link}
          aria-label="Messenger link"
          onFocus={(event) => event.currentTarget.select()}
          className={`${fieldClass} font-mono text-xs`}
        />
        <div className="mt-3 flex">
          <CopyTextButton value={link} label="Copy link" name="Messenger link" />
        </div>
      </Section>

      <Section title="Post text" hint="Ready to paste into a Facebook post.">
        <textarea
          readOnly
          value={postText}
          rows={8}
          aria-label="Post text"
          className={`${fieldClass} soft-scroll resize-none text-sm leading-6`}
        />
        <div className="mt-3 flex">
          <CopyTextButton value={postText} label="Copy post text" name="Post text" />
        </div>
      </Section>

      <Section title="How to post">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-6 text-ink-soft">
          <li>Copy the post text.</li>
          <li>
            On your Facebook Page, create a post, paste the text and add the{' '}
            <a
              href={product.imageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-800"
            >
              product photo
            </a>
            .
          </li>
          <li>
            Or use <strong className="font-semibold text-ink">Share on Facebook</strong> to share the link on its own.
          </li>
        </ol>
      </Section>
    </>
  );
}

function PageNotSet() {
  const code = (text: string) => <code className="font-mono">{text}</code>;
  return (
    <Alert tone="warning" title="Facebook Page username is not set">
      <p>
        Set {code('NEXT_PUBLIC_FACEBOOK_PAGE_USERNAME')} to your Page’s username (the part after facebook.com/) in{' '}
        {code('web/.env.local')} and restart {code('pnpm dev')}. On Vercel, add it under Settings › Environment
        Variables and redeploy.
      </p>
    </Alert>
  );
}

function ShareFooter({ link }: { link: string }) {
  return (
    <div className="flex gap-3">
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-line px-4 py-3 text-sm font-semibold text-ink-soft hover:bg-brand-50"
      >
        <ExternalLink size={16} aria-hidden />
        Test link
      </a>
      <a
        href={facebookShareUrl(link)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-800"
      >
        <Share2 size={16} aria-hidden />
        Share on Facebook
      </a>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line p-4">
      <h4 className="text-xs font-bold uppercase tracking-[.11em] text-muted">{title}</h4>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}
