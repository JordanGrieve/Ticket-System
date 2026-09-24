"use client";

import type { CampaignProduct } from "@/db/schema";
import { MAX_PRODUCTS, safeImageUrl } from "@/lib/newsletter";
import "../../app/newsletter.css";

/**
 * The image and the product grid, as authored — shared by the campaign
 * composer and the welcome newsletter, which carry the same pieces and are
 * validated by the same functions (safeImageUrl, parseProducts).
 *
 * There used to be two copies. The welcome's keyed its removable rows by
 * array index and named its inputs only by placeholder; this one is the
 * composer's, which did neither.
 */

/**
 * One product row while it is being typed.
 *
 * Strings rather than CampaignProduct, because a half-typed URL is a normal
 * state of a form and null is not a thing a text input can hold. Each caller
 * converts on save.
 *
 * The id is a client-side key and never leaves the browser. React needs a
 * stable key per row, and the array index is not one: deleting the second of
 * four rows would have React reuse the third row's DOM for the fourth, so the
 * text in a focused input would jump to the row above it.
 */
export type DraftProduct = {
  id: number;
  name: string;
  imageUrl: string;
  price: string;
  url: string;
};

export function blankDraftProduct(id: number): DraftProduct {
  return { id, name: "", imageUrl: "", price: "", url: "" };
}

export function draftProductFrom(p: CampaignProduct, id: number): DraftProduct {
  return {
    id,
    name: p.name,
    imageUrl: p.imageUrl ?? "",
    price: p.price ?? "",
    url: p.url ?? "",
  };
}

export type HeroAndProducts = {
  /** As authored. Validated server-side; empty string means none. */
  heroImageUrl: string;
  heroImageAlt: string;
  products: DraftProduct[];
};

type ProductField = "name" | "price" | "imageUrl" | "url";

export default function ProductsHeroEditor({
  heroImageUrl,
  heroImageAlt,
  products,
  disabled,
  onChange,
  newProduct,
}: HeroAndProducts & {
  disabled: boolean;
  onChange: (next: Partial<HeroAndProducts>) => void;
  /** Mints the next row. Its id must be unique for the life of the form. */
  newProduct: () => DraftProduct;
}) {
  function setField(id: number, field: ProductField, value: string) {
    onChange({
      products: products.map((q) => (q.id === id ? { ...q, [field]: value } : q)),
    });
  }

  return (
    <>
      {/*
        ── THE IMAGE ──
        A URL the client already has, from their own shop or site.
        Postbox hosts no files, so there is nothing to upload to.

        The description is not optional and the hint says why: Gmail
        and Outlook block remote images by default for a sender
        somebody has not corresponded with, which is most recipients
        of a first newsletter. For them the description IS the image.
      */}
      <div className="nl-field">
        <label className="nl-label" htmlFor="nl-hero-url">
          Image <span className="nl-optional">OPTIONAL</span>
        </label>
        <input
          id="nl-hero-url"
          className="nl-input"
          type="url"
          inputMode="url"
          placeholder="https://yourshop.com/photo.jpg"
          value={heroImageUrl}
          maxLength={2000}
          disabled={disabled}
          onChange={(e) => onChange({ heroImageUrl: e.target.value })}
        />
        {heroImageUrl.trim() && !safeImageUrl(heroImageUrl) && (
          <p className="nl-warn" role="status">
            That link can&rsquo;t be used. It needs to start with{" "}
            <b>https://</b>
          </p>
        )}
      </div>

      {heroImageUrl.trim() && (
        <div className="nl-field">
          <label className="nl-label" htmlFor="nl-hero-alt">
            Describe the image
          </label>
          <input
            id="nl-hero-alt"
            className="nl-input"
            type="text"
            placeholder="A tray of sourdough, just out of the oven"
            value={heroImageAlt}
            maxLength={200}
            disabled={disabled}
            onChange={(e) => onChange({ heroImageAlt: e.target.value })}
          />
          <p className="nl-help">
            Most people have images turned off, and read this instead.
            Keep anything that matters — a price, a date — in the
            message as well as the picture.
          </p>
        </div>
      )}

      {/*
        ── PRODUCTS ──
        A short grid under the message: a photo, a name, a price, a
        link. The name IS the link when there is one, so a product is
        one target rather than a name and a "Buy" beside it.

        Rows are added one at a time rather than starting with three
        blanks. Three empty rows read as three things you are expected
        to fill in; an empty section with one button reads as optional,
        which it is.
      */}
      <div className="nl-field">
        <span className="nl-label" id="nl-products-label">
          Products <span className="nl-optional">OPTIONAL</span>
        </span>

        <ul className="nl-products" aria-labelledby="nl-products-label">
          {products.map((p, i) => (
            <li className="nl-product" key={p.id}>
              <div className="nl-product-head">
                <span className="nl-product-n">{i + 1}</span>
                <button
                  type="button"
                  className="nl-product-x"
                  disabled={disabled}
                  onClick={() =>
                    onChange({
                      products: products.filter((q) => q.id !== p.id),
                    })
                  }
                >
                  Remove<span className="stg-sr-only"> product {i + 1}</span>
                </button>
              </div>

              <label className="nl-sublabel" htmlFor={`nl-p-name-${p.id}`}>
                Name
              </label>
              <input
                id={`nl-p-name-${p.id}`}
                className="nl-input"
                type="text"
                placeholder="Sourdough loaf"
                value={p.name}
                maxLength={120}
                disabled={disabled}
                onChange={(e) => setField(p.id, "name", e.target.value)}
              />

              <label className="nl-sublabel" htmlFor={`nl-p-price-${p.id}`}>
                Price
              </label>
              {/*
                Free text, not a number input. "from £2" and "2 for £5"
                are prices a bakery actually charges, and a number field
                would make them untypable.
              */}
              <input
                id={`nl-p-price-${p.id}`}
                className="nl-input"
                type="text"
                placeholder="£3.50"
                value={p.price}
                maxLength={40}
                disabled={disabled}
                onChange={(e) => setField(p.id, "price", e.target.value)}
              />

              <label className="nl-sublabel" htmlFor={`nl-p-img-${p.id}`}>
                Photo link
              </label>
              <input
                id={`nl-p-img-${p.id}`}
                className="nl-input"
                type="url"
                inputMode="url"
                placeholder="https://yourshop.com/loaf.jpg"
                value={p.imageUrl}
                maxLength={2000}
                disabled={disabled}
                onChange={(e) => setField(p.id, "imageUrl", e.target.value)}
              />
              {p.imageUrl.trim() && !safeImageUrl(p.imageUrl) && (
                <p className="nl-warn" role="status">
                  That photo link can&rsquo;t be used. It needs to start
                  with <b>https://</b>
                </p>
              )}

              <label className="nl-sublabel" htmlFor={`nl-p-url-${p.id}`}>
                Buy link
              </label>
              <input
                id={`nl-p-url-${p.id}`}
                className="nl-input"
                type="url"
                inputMode="url"
                placeholder="https://yourshop.com/loaf"
                value={p.url}
                maxLength={2000}
                disabled={disabled}
                onChange={(e) => setField(p.id, "url", e.target.value)}
              />
              {p.url.trim() && !safeImageUrl(p.url) && (
                <p className="nl-warn" role="status">
                  That link can&rsquo;t be used. It needs to start with{" "}
                  <b>https://</b>
                </p>
              )}
            </li>
          ))}
        </ul>

        {products.length < MAX_PRODUCTS ? (
          <button
            type="button"
            className="stg-button"
            disabled={disabled}
            onClick={() => onChange({ products: [...products, newProduct()] })}
          >
            Add a product
          </button>
        ) : (
          <p className="nl-help" role="status">
            That&rsquo;s {MAX_PRODUCTS}, the most one newsletter can
            carry.
          </p>
        )}
      </div>
    </>
  );
}
