import { useState } from "react";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Layout,
  Link,
  Page,
  Text,
  TextField,
  Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { submitPairing, PLATFORM_BASE_URL } from "../utils/platform.server";

// 24-character pairing token, matching the October MI WordPress plugin UX.
const PAIRING_TOKEN_LENGTH = 24;

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const pairing = await prisma.storePairing.findUnique({
    where: { shop: session.shop },
  });

  return json({
    shop: session.shop,
    platformBaseUrl: PLATFORM_BASE_URL,
    pairing: pairing
      ? {
          clientName: pairing.clientName,
          clientId: pairing.clientId,
          status: pairing.status,
          lastSyncAt: pairing.lastSyncAt
            ? pairing.lastSyncAt.toISOString()
            : null,
          eventsThisWeek: pairing.eventsThisWeek,
        }
      : null,
  });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const formData = await request.formData();
  const pairingToken = String(formData.get("pairingToken") || "").trim();

  if (pairingToken.length !== PAIRING_TOKEN_LENGTH) {
    return json(
      {
        ok: false,
        error: `Pairing tokens are ${PAIRING_TOKEN_LENGTH} characters. Please check the token in your October dashboard.`,
      },
      { status: 422 },
    );
  }

  try {
    const result = await submitPairing({
      shop: session.shop,
      accessToken: session.accessToken,
      pairingToken,
    });

    // Persist the confirmed link so the embedded admin shows "Connected".
    await prisma.storePairing.upsert({
      where: { shop: session.shop },
      update: {
        clientId: result.client_id ?? null,
        clientName: result.client_name ?? null,
        status: "connected",
        pairedAt: new Date(),
      },
      create: {
        shop: session.shop,
        clientId: result.client_id ?? null,
        clientName: result.client_name ?? null,
        status: "connected",
      },
    });

    return json({ ok: true });
  } catch (error) {
    return json(
      {
        ok: false,
        error:
          "We couldn't verify that token with October Marketing Intelligence. Please confirm it and try again.",
      },
      { status: 502 },
    );
  }
};

function formatTimestamp(iso) {
  if (!iso) return "No events synced yet";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export default function Index() {
  const { pairing, platformBaseUrl, shop } = useLoaderData();
  const fetcher = useFetcher();
  const [token, setToken] = useState("");

  const isSubmitting =
    fetcher.state === "submitting" || fetcher.state === "loading";
  const actionError = fetcher.data && !fetcher.data.ok ? fetcher.data.error : null;
  const connected = pairing?.status === "connected";

  const dashboardUrl = pairing?.clientId
    ? `${platformBaseUrl}/clients/${pairing.clientId}`
    : `${platformBaseUrl}`;

  return (
    <Page>
      <TitleBar title="October Marketing Intelligence" />
      <Layout>
        <Layout.Section>
          {connected ? (
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <span
                      aria-hidden="true"
                      style={{
                        display: "inline-block",
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        backgroundColor: "#1f7a3d",
                      }}
                    />
                    <Text as="h2" variant="headingMd">
                      Connected to {pairing.clientName || "your October account"}
                    </Text>
                  </InlineStack>
                  <Badge tone="success">Live</Badge>
                </InlineStack>

                <Text as="p" tone="subdued">
                  Store activity from <strong>{shop}</strong> is syncing to
                  October Marketing Intelligence in real time.
                </Text>

                <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                  <Box
                    background="bg-surface-secondary"
                    borderRadius="200"
                    padding="400"
                  >
                    <BlockStack gap="100">
                      <Text as="span" tone="subdued" variant="bodySm">
                        Last sync
                      </Text>
                      <Text as="span" variant="headingSm">
                        {formatTimestamp(pairing.lastSyncAt)}
                      </Text>
                    </BlockStack>
                  </Box>
                  <Box
                    background="bg-surface-secondary"
                    borderRadius="200"
                    padding="400"
                  >
                    <BlockStack gap="100">
                      <Text as="span" tone="subdued" variant="bodySm">
                        Events synced this week
                      </Text>
                      <Text as="span" variant="headingSm">
                        {pairing.eventsThisWeek ?? 0}
                      </Text>
                    </BlockStack>
                  </Box>
                </InlineGrid>

                <InlineStack>
                  <Button url={dashboardUrl} target="_blank" variant="primary">
                    Open your October dashboard
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          ) : (
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Pair this store with your October Marketing Intelligence
                  account
                </Text>
                <Text as="p" tone="subdued">
                  Paste the 24-character pairing token from your October
                  dashboard. We'll link <strong>{shop}</strong> to your client
                  account and begin syncing store activity.
                </Text>

                {actionError && (
                  <Banner tone="critical">
                    <p>{actionError}</p>
                  </Banner>
                )}

                <fetcher.Form method="post">
                  <BlockStack gap="300">
                    <TextField
                      label="Pairing token"
                      name="pairingToken"
                      value={token}
                      onChange={setToken}
                      autoComplete="off"
                      maxLength={PAIRING_TOKEN_LENGTH}
                      placeholder="e.g. 3f9ak2lp7qz8wn4rd6sm0c1v"
                      helpText={`${PAIRING_TOKEN_LENGTH} characters. Find it under Settings → Integrations in your October dashboard.`}
                    />
                    <InlineStack>
                      <Button
                        submit
                        variant="primary"
                        loading={isSubmitting}
                        disabled={token.trim().length !== PAIRING_TOKEN_LENGTH}
                      >
                        Pair store
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </fetcher.Form>

                <Text as="p" tone="subdued" variant="bodySm">
                  Don't have a token? Open{" "}
                  <Link url={platformBaseUrl} target="_blank">
                    your October dashboard
                  </Link>{" "}
                  and generate one under Integrations.
                </Text>
              </BlockStack>
            </Card>
          )}
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                What we sync
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Orders, refunds, customers, products, inventory levels, theme
                publishes and abandoned checkouts — read-only and forwarded
                securely to October Marketing Intelligence.
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                October MI never writes to your store and only requests
                read-only scopes.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
