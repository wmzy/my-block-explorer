import React from "react";
import { useParams } from "react-router-dom";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../components/ui/Card";

export function TransactionPage() {
  const { chainId, txHash } = useParams();

  return (
    <Card>
      <CardHeader>
        <CardTitle>交易详情</CardTitle>
      </CardHeader>
      <CardContent>
        <p>Chain ID: {chainId}</p>
        <p>Transaction Hash: {txHash}</p>
        <p>此页面正在开发中...</p>
      </CardContent>
    </Card>
  );
}
