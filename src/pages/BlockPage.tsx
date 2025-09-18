import React from "react";
import { useParams } from "react-router-dom";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../components/ui/Card";

export function BlockPage() {
  const { chainId, blockNumber, blockHash } = useParams();

  return (
    <Card>
      <CardHeader>
        <CardTitle>区块详情</CardTitle>
      </CardHeader>
      <CardContent>
        <p>Chain ID: {chainId}</p>
        {blockNumber && <p>Block Number: {blockNumber}</p>}
        {blockHash && <p>Block Hash: {blockHash}</p>}
        <p>此页面正在开发中...</p>
      </CardContent>
    </Card>
  );
}
