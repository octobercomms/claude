import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  // If a shop is present, kick straight into the embedded app / OAuth.
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function Index() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>October Marketing Intelligence</h1>
        <p className={styles.text}>
          Connect your Shopify store to October Marketing Intelligence for
          real-time commerce signals across orders, customers, products and
          inventory — all feeding your October dashboard.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input
                className={styles.input}
                type="text"
                name="shop"
                placeholder="my-store.myshopify.com"
              />
              <span>e.g: my-store.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Install
            </button>
          </Form>
        )}
      </div>
    </div>
  );
}
