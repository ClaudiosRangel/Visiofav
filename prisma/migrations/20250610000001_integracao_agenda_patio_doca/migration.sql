-- AlterTable: Add UNIQUE constraint on agendamento_id for 1:1 relation
CREATE UNIQUE INDEX "veiculo_patio_agendamento_id_key" ON "veiculo_patio"("agendamento_id");

-- AddForeignKey: VeiculoPatio.agendamento_id → AgendaWms.id with SET NULL on delete
ALTER TABLE "veiculo_patio" ADD CONSTRAINT "veiculo_patio_agendamento_id_fkey" FOREIGN KEY ("agendamento_id") REFERENCES "agenda_wms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: VeiculoPatio.empresa_id → empresa.id
ALTER TABLE "veiculo_patio" ADD CONSTRAINT "veiculo_patio_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: VeiculoPatio.cd_id → centro_distribuicao.id
ALTER TABLE "veiculo_patio" ADD CONSTRAINT "veiculo_patio_cd_id_fkey" FOREIGN KEY ("cd_id") REFERENCES "centro_distribuicao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: VeiculoPatio.doca_id → doca.id
ALTER TABLE "veiculo_patio" ADD CONSTRAINT "veiculo_patio_doca_id_fkey" FOREIGN KEY ("doca_id") REFERENCES "doca"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: ChamadaDoca.veiculo_id → veiculo_patio.id
ALTER TABLE "chamada_doca" ADD CONSTRAINT "chamada_doca_veiculo_id_fkey" FOREIGN KEY ("veiculo_id") REFERENCES "veiculo_patio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: ChamadaDoca.doca_id → doca.id
ALTER TABLE "chamada_doca" ADD CONSTRAINT "chamada_doca_doca_id_fkey" FOREIGN KEY ("doca_id") REFERENCES "doca"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
